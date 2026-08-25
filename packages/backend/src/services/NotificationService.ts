import nodemailer from 'nodemailer';
import prisma from '../lib/prisma';
import { locationInfo } from './LocationService';
import {
  metaWhatsappConfigured,
  platformEmailConfigured,
  resolveBusinessSmtp,
  resolveEnvSmtp,
  resolveResend,
  resolveWhatsappCredentials,
  smtpConfigured,
  type GupshupWhatsappConfig,
  type MetaWhatsappConfig,
  type TwilioWhatsappConfig,
  type WhatsappPlatformConfig,
} from './notificationCredentials';
import { walletService } from './WalletService';
import { whatsappPricingService } from './WhatsAppPricingService';
import {
  isValidNotifyEmail,
  isValidWhatsappNumber,
} from './CustomerService';
import { contactMatchesFilters } from './CustomerAttributes';
import { htmlToPlainText, wrapEmailMessage } from './MessageFormat';

type SendOpts = {
  replyTo?: string;
  throwOnError?: boolean;
  business?: any;
  /** Wallet pricing category (defaults to UTILITY). Broadcasts should pass MARKETING. */
  category?: string;
  /** Reference context for WhatsAppMessageLog + wallet ledger. */
  bookingId?: string;
  customerId?: string;
  /** When true, insufficient wallet credits throw (async jobs like reminders that must retry). */
  throwOnInsufficient?: boolean;
};

class NotificationService {
  /** HTML-escape user-controlled values interpolated into email templates. */
  private esc(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
    ));
  }

  private bookingServiceName(booking: any): string {
    return String(booking?.serviceNameSnapshot || booking?.service?.name || 'Appointment');
  }

  smtpConfigured(business?: any): boolean {
    return smtpConfigured(business);
  }

  metaWhatsappConfigured(business?: any): boolean {
    return metaWhatsappConfigured(business);
  }

  /** Location block for email templates (empty when the salon has no location). */
  private locationHtml(business: any): string {
    const loc = locationInfo(business);
    if (!loc.directionsUrl) return '';
    const addr = loc.address ? `<p><strong>Address:</strong> ${this.esc(loc.address)}</p>` : '';
    return `<div style="background:#EEF2FF; padding:12px; border-radius:8px; margin:12px 0;">
      ${addr}
      <p><a href="${this.esc(loc.directionsUrl)}" style="color:#4338CA; font-weight:600;">Get directions on Google Maps ↗</a></p>
    </div>`;
  }

  /** Location + owner contact lines for WhatsApp bodies (empty when unset). */
  private locationText(business: any): { address: string; directions: string; contact: string } {
    const loc = locationInfo(business);
    return {
      address: loc.address ? `📍 ${loc.address}\n` : '',
      directions: loc.directionsUrl ? `🗺️ Directions: ${loc.directionsUrl}\n` : '',
      contact: business.ownerWhatsapp
        ? `📞 Contact: https://wa.me/${String(business.ownerWhatsapp).replace(/\D/g, '')}\n`
        : '',
    };
  }

  private async sendViaResend(to: string, subject: string, html: string, opts: SendOpts): Promise<void> {
    const resend = resolveResend();
    if (!resend) throw new Error('Email: Resend is not configured (RESEND_API_KEY).');
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resend.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: resend.from,
        to: [to],
        subject,
        html,
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Email: Resend send failed (${res.status}): ${body.slice(0, 300)}`);
    }
    console.log(`Email sent via Resend to ${to}: ${subject}`);
  }

  private async sendViaSmtp(
    smtp: NonNullable<ReturnType<typeof resolveEnvSmtp>>,
    to: string,
    subject: string,
    html: string,
    opts: SendOpts
  ): Promise<void> {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    await transporter.sendMail({
      from: `"${smtp.fromName}" <${smtp.user}>`,
      to,
      subject,
      html,
      ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
    });
    console.log(`Email sent to ${to}: ${subject}`);
  }

  private async sendEmail(to: string, subject: string, html: string, opts: SendOpts = {}): Promise<void> {
    // Priority: salon SMTP → Resend (HTTPS, works on Render free) → env SMTP (local/dev).
    const businessSmtp = resolveBusinessSmtp(opts.business);
    const resend = resolveResend();
    const envSmtp = resolveEnvSmtp();

    if (!businessSmtp && !resend && !envSmtp) {
      const err = new Error(
        'Email: not configured. Set RESEND_API_KEY (recommended on Render) or SMTP_USER/SMTP_PASS, or salon SMTP in Settings.'
      );
      console.log(err.message);
      if (opts.throwOnError) throw err;
      return;
    }

    try {
      if (businessSmtp) {
        await this.sendViaSmtp(businessSmtp, to, subject, html, opts);
        return;
      }
      if (resend) {
        await this.sendViaResend(to, subject, html, opts);
        return;
      }
      await this.sendViaSmtp(envSmtp!, to, subject, html, opts);
    } catch (error) {
      console.error('Email sending failed:', error);
      if (opts.throwOnError) throw error;
    }
  }

  /**
   * Digits-only WhatsApp destination for providers (Gupshup/Meta/Twilio).
   * Indian 10-digit mobiles are prefixed with 91 when country code is missing —
   * otherwise the provider may accept the API call but never deliver.
   */
  private normalizeWhatsappDestination(value: string): string {
    let digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    // Strip a single leading 0 (common local format 0XXXXXXXXXX).
    if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    if (digits.length === 10 && /^[6-9]/.test(digits)) return `91${digits}`;
    return digits;
  }

  private outsideSessionError(bodyText: string): boolean {
    return /customer service window|outside.*24|template|63016|63049|session.*expired|not in.*session/i.test(bodyText);
  }

  private metaTemplateName(meta: MetaWhatsappConfig, category: string): string | null {
    if (category === 'MARKETING') return meta.marketingTemplate || meta.utilityTemplate || null;
    return meta.utilityTemplate || null;
  }

  private twilioContentSid(twilio: TwilioWhatsappConfig, category: string): string | null {
    if (category === 'MARKETING') return twilio.marketingContentSid || twilio.utilityContentSid || null;
    return twilio.utilityContentSid || null;
  }

  private gupshupTemplateId(gupshup: GupshupWhatsappConfig, category: string): string | null {
    if (category === 'MARKETING') return gupshup.marketingTemplate || gupshup.utilityTemplate || null;
    return gupshup.utilityTemplate || null;
  }

  private gupshupResponseOk(response: Response, bodyText: string): boolean {
    if (!response.ok) return false;
    try {
      const parsed = JSON.parse(bodyText || '{}');
      if (parsed?.status === 'error') return false;
    } catch {
      /* non-JSON body — rely on HTTP status */
    }
    return true;
  }

  private async sendMetaWhatsappText(meta: MetaWhatsappConfig, toDigits: string, message: string): Promise<Response> {
    const url = `https://graph.facebook.com/v20.0/${meta.phoneNumberId}/messages`;
    return fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${meta.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toDigits,
        type: 'text',
        text: { preview_url: false, body: message },
      }),
    });
  }

  private async sendMetaWhatsappTemplate(
    meta: MetaWhatsappConfig,
    toDigits: string,
    templateName: string,
    message: string
  ): Promise<Response> {
    const url = `https://graph.facebook.com/v20.0/${meta.phoneNumberId}/messages`;
    return fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${meta.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toDigits,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en' },
          components: [
            {
              type: 'body',
              parameters: [{ type: 'text', text: message.slice(0, 1024) }],
            },
          ],
        },
      }),
    });
  }

  private async sendMetaWhatsappImage(
    meta: MetaWhatsappConfig,
    toDigits: string,
    imageUrl: string,
    caption: string
  ): Promise<Response> {
    const url = `https://graph.facebook.com/v20.0/${meta.phoneNumberId}/messages`;
    return fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${meta.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toDigits,
        type: 'image',
        image: {
          link: imageUrl,
          ...(caption ? { caption: caption.slice(0, 1024) } : {}),
        },
      }),
    });
  }

  private async sendMetaWhatsappCta(
    meta: MetaWhatsappConfig,
    toDigits: string,
    body: string,
    displayText: string,
    buttonUrl: string
  ): Promise<Response> {
    const url = `https://graph.facebook.com/v20.0/${meta.phoneNumberId}/messages`;
    return fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${meta.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toDigits,
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          body: { text: body.slice(0, 1024) },
          action: {
            name: 'cta_url',
            parameters: {
              display_text: displayText.slice(0, 20),
              url: buttonUrl,
            },
          },
        },
      }),
    });
  }

  private twilioAuthHeader(twilio: TwilioWhatsappConfig): string {
    return `Basic ${Buffer.from(`${twilio.accountSid}:${twilio.authToken}`).toString('base64')}`;
  }

  private async sendTwilioWhatsappForm(
    twilio: TwilioWhatsappConfig,
    fields: Record<string, string>
  ): Promise<Response> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilio.accountSid)}/Messages.json`;
    const body = new URLSearchParams(fields);
    return fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.twilioAuthHeader(twilio),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
  }

  private async sendTwilioWhatsappText(
    twilio: TwilioWhatsappConfig,
    toDigits: string,
    message: string
  ): Promise<Response> {
    return this.sendTwilioWhatsappForm(twilio, {
      From: twilio.from,
      To: `whatsapp:+${toDigits}`,
      Body: message.slice(0, 1600),
    });
  }

  private async sendTwilioWhatsappImage(
    twilio: TwilioWhatsappConfig,
    toDigits: string,
    imageUrl: string,
    caption: string
  ): Promise<Response> {
    return this.sendTwilioWhatsappForm(twilio, {
      From: twilio.from,
      To: `whatsapp:+${toDigits}`,
      MediaUrl: imageUrl,
      ...(caption ? { Body: caption.slice(0, 1600) } : {}),
    });
  }

  private async sendTwilioWhatsappTemplate(
    twilio: TwilioWhatsappConfig,
    toDigits: string,
    contentSid: string,
    message: string
  ): Promise<Response> {
    return this.sendTwilioWhatsappForm(twilio, {
      From: twilio.from,
      To: `whatsapp:+${toDigits}`,
      ContentSid: contentSid,
      ContentVariables: JSON.stringify({ '1': message.slice(0, 1024) }),
    });
  }

  private async sendGupshupForm(
    gupshup: GupshupWhatsappConfig,
    path: '/wa/api/v1/msg' | '/wa/api/v1/template/msg',
    fields: Record<string, string>
  ): Promise<Response> {
    const body = new URLSearchParams({
      channel: 'whatsapp',
      source: gupshup.source,
      'src.name': gupshup.appName,
      ...fields,
    });
    return fetch(`https://api.gupshup.io${path}`, {
      method: 'POST',
      headers: {
        apikey: gupshup.apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
  }

  private async sendGupshupWhatsappText(
    gupshup: GupshupWhatsappConfig,
    toDigits: string,
    message: string
  ): Promise<Response> {
    return this.sendGupshupForm(gupshup, '/wa/api/v1/msg', {
      destination: toDigits,
      message: JSON.stringify({ type: 'text', text: message.slice(0, 4096) }),
    });
  }

  private async sendGupshupWhatsappImage(
    gupshup: GupshupWhatsappConfig,
    toDigits: string,
    imageUrl: string,
    caption: string
  ): Promise<Response> {
    return this.sendGupshupForm(gupshup, '/wa/api/v1/msg', {
      destination: toDigits,
      message: JSON.stringify({
        type: 'image',
        originalUrl: imageUrl,
        previewUrl: imageUrl,
        ...(caption ? { caption: caption.slice(0, 1024) } : {}),
      }),
    });
  }

  private async sendGupshupWhatsappCta(
    gupshup: GupshupWhatsappConfig,
    toDigits: string,
    body: string,
    displayText: string,
    buttonUrl: string
  ): Promise<Response> {
    return this.sendGupshupForm(gupshup, '/wa/api/v1/msg', {
      destination: toDigits,
      message: JSON.stringify({
        type: 'cta_url',
        body: body.slice(0, 1024),
        display_text: displayText.slice(0, 20),
        url: buttonUrl,
      }),
    });
  }

  private async sendGupshupWhatsappTemplate(
    gupshup: GupshupWhatsappConfig,
    toDigits: string,
    templateId: string,
    message: string
  ): Promise<Response> {
    // Meta rejects template variable values that contain newlines / tabs /
    // long runs of spaces — Gupshup still returns "submitted", then delivery fails.
    // URLs and heavy emoji in {{1}} are also frequent silent drops; keep params plain.
    const param = String(message || '')
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/[·•]+/g, ' ')
      .replace(/ {5,}/g, '    ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 900);
    return this.sendGupshupForm(gupshup, '/wa/api/v1/template/msg', {
      destination: toDigits,
      template: JSON.stringify({
        id: templateId,
        params: [param || 'Your booking was updated.'],
      }),
    });
  }

  private async dispatchWhatsapp(
    platform: WhatsappPlatformConfig,
    toDigits: string,
    message: string,
    category: string,
    opts: { imageUrl?: string | null; cta?: { displayText: string; url: string } | null }
  ): Promise<{ response: Response; bodyText: string }> {
    const imageUrl = this.absolutePublicUrl(opts.imageUrl || '');
    const ctaUrl = opts.cta?.url && /^https:\/\//i.test(opts.cta.url) ? opts.cta.url : null;
    const ctaText = opts.cta?.displayText || 'View or cancel';

    if (platform.provider === 'twilio') {
      return this.dispatchTwilioWhatsapp(platform, toDigits, message, category, imageUrl, ctaUrl, ctaText);
    }
    if (platform.provider === 'gupshup') {
      return this.dispatchGupshupWhatsapp(platform, toDigits, message, category, imageUrl, ctaUrl, ctaText);
    }
    return this.dispatchMetaWhatsapp(platform, toDigits, message, category, imageUrl, ctaUrl, ctaText);
  }

  private async dispatchMetaWhatsapp(
    meta: MetaWhatsappConfig,
    toDigits: string,
    message: string,
    category: string,
    imageUrl: string | null,
    ctaUrl: string | null,
    ctaText: string
  ): Promise<{ response: Response; bodyText: string }> {
    const templateName = this.metaTemplateName(meta, category);
    let response: Response;
    let bodyText = '';

    const tryTemplate = async (text: string) => {
      if (!templateName) return;
      response = await this.sendMetaWhatsappTemplate(meta, toDigits, templateName, text);
      bodyText = response.ok ? '' : await response.text();
    };

    if (imageUrl) {
      response = await this.sendMetaWhatsappImage(meta, toDigits, imageUrl, message);
      bodyText = response.ok ? '' : await response.text();
      if (!response.ok && this.outsideSessionError(bodyText)) {
        const withLink = `${message}\n\nImage: ${imageUrl}`.trim();
        response = await this.sendMetaWhatsappText(meta, toDigits, withLink);
        bodyText = response.ok ? '' : await response.text();
        if (!response.ok && this.outsideSessionError(bodyText)) await tryTemplate(withLink);
      }
    } else if (ctaUrl) {
      response = await this.sendMetaWhatsappCta(meta, toDigits, message, ctaText, ctaUrl);
      bodyText = response.ok ? '' : await response.text();
      if (!response.ok) {
        const withLink = `${message}\n\n${ctaText}: ${ctaUrl}`.trim();
        response = await this.sendMetaWhatsappText(meta, toDigits, withLink);
        bodyText = response.ok ? '' : await response.text();
        if (!response.ok && this.outsideSessionError(bodyText)) await tryTemplate(withLink);
      }
    } else {
      response = await this.sendMetaWhatsappText(meta, toDigits, message);
      bodyText = response.ok ? '' : await response.text();
      if (!response.ok && this.outsideSessionError(bodyText)) await tryTemplate(message);
    }

    return { response: response!, bodyText };
  }

  private async dispatchTwilioWhatsapp(
    twilio: TwilioWhatsappConfig,
    toDigits: string,
    message: string,
    category: string,
    imageUrl: string | null,
    ctaUrl: string | null,
    ctaText: string
  ): Promise<{ response: Response; bodyText: string }> {
    const contentSid = this.twilioContentSid(twilio, category);
    let response: Response;
    let bodyText = '';

    const tryTemplate = async (text: string) => {
      if (!contentSid) return;
      response = await this.sendTwilioWhatsappTemplate(twilio, toDigits, contentSid, text);
      bodyText = response.ok ? '' : await response.text();
    };

    const textBody = ctaUrl ? `${message}\n\n${ctaText}: ${ctaUrl}`.trim() : message;

    if (imageUrl) {
      response = await this.sendTwilioWhatsappImage(twilio, toDigits, imageUrl, textBody);
      bodyText = response.ok ? '' : await response.text();
      if (!response.ok && this.outsideSessionError(bodyText)) {
        const withLink = `${textBody}\n\nImage: ${imageUrl}`.trim();
        response = await this.sendTwilioWhatsappText(twilio, toDigits, withLink);
        bodyText = response.ok ? '' : await response.text();
        if (!response.ok && this.outsideSessionError(bodyText)) await tryTemplate(withLink);
      }
    } else {
      response = await this.sendTwilioWhatsappText(twilio, toDigits, textBody);
      bodyText = response.ok ? '' : await response.text();
      if (!response.ok && this.outsideSessionError(bodyText)) await tryTemplate(textBody);
    }

    return { response: response!, bodyText };
  }

  private async dispatchGupshupWhatsapp(
    gupshup: GupshupWhatsappConfig,
    toDigits: string,
    message: string,
    category: string,
    imageUrl: string | null,
    ctaUrl: string | null,
    ctaText: string
  ): Promise<{ response: Response; bodyText: string }> {
    const templateId = this.gupshupTemplateId(gupshup, category);
    let response: Response;
    let bodyText = '';

    const readBody = async (res: Response) => {
      response = res;
      bodyText = await res.text();
    };

    const failed = () => !this.gupshupResponseOk(response!, bodyText);

    // Gupshup returns HTTP 202 "submitted" for session sends even when the user is
    // outside the 24h window — delivery then fails asynchronously. Prefer an
    // APPROVED template whenever configured so booking alerts actually arrive.
    if (templateId) {
      let templateBody = message;
      if (imageUrl) templateBody = `${message}\n\nImage: ${imageUrl}`.trim();
      else if (ctaUrl) templateBody = `${message}\n\n${ctaText}: ${ctaUrl}`.trim();
      await readBody(await this.sendGupshupWhatsappTemplate(gupshup, toDigits, templateId, templateBody));
      if (!failed()) {
        return { response: response!, bodyText };
      }
      // Fall through to session types only if the template call itself failed.
    }

    if (imageUrl) {
      await readBody(await this.sendGupshupWhatsappImage(gupshup, toDigits, imageUrl, message));
      if (failed()) {
        const withLink = `${message}\n\nImage: ${imageUrl}`.trim();
        await readBody(await this.sendGupshupWhatsappText(gupshup, toDigits, withLink));
      }
    } else if (ctaUrl) {
      await readBody(await this.sendGupshupWhatsappCta(gupshup, toDigits, message, ctaText, ctaUrl));
      if (failed()) {
        const withLink = `${message}\n\n${ctaText}: ${ctaUrl}`.trim();
        await readBody(await this.sendGupshupWhatsappText(gupshup, toDigits, withLink));
      }
    } else {
      await readBody(await this.sendGupshupWhatsappText(gupshup, toDigits, message));
    }

    // Normalize so callers treating !response.ok as failure also catch Gupshup JSON errors.
    if (failed() && response!.ok) {
      return {
        response: new Response(bodyText, { status: 400, statusText: 'Gupshup error' }),
        bodyText,
      };
    }

    return { response: response!, bodyText };
  }

  private absolutePublicUrl(url: string): string | null {
    const raw = String(url || '').trim();
    if (!raw) return null;
    if (/^https:\/\//i.test(raw)) return raw;
    if (raw.startsWith('/api/media/')) {
      const base = (process.env.FRONTEND_PUBLIC_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
      if (!base) return null;
      return `${base}${raw}`;
    }
    return null;
  }

  private async logWhatsAppMessage(
    businessId: string,
    opts: SendOpts & { imageUrl?: string | null; cta?: { displayText: string; url: string } | null },
    toDigits: string,
    category: string,
    costPaise: number,
    status: string,
    failureReason: string | null,
    reservationTxId?: string | null,
    providerMessageId?: string | null
  ): Promise<void> {
    try {
      await prisma.whatsAppMessageLog.create({
        data: {
          businessId,
          bookingId: opts.bookingId || null,
          customerId: opts.customerId || null,
          toPhone: toDigits,
          category,
          costPaise,
          reservationTxId: reservationTxId || null,
          providerMessageId: providerMessageId || null,
          status,
          failureReason,
        },
      });
    } catch (e: any) {
      console.error('WhatsApp message log write failed:', e?.message || e);
    }
  }

  private parseProviderMessageId(bodyText: string): string | null {
    try {
      const parsed = JSON.parse(bodyText);
      const metaId = parsed?.messages?.[0]?.id;
      if (typeof metaId === 'string' && metaId) return metaId;
      const twilioSid = parsed?.sid;
      if (typeof twilioSid === 'string' && twilioSid) return twilioSid;
      const gupshupId = parsed?.messageId;
      if (typeof gupshupId === 'string' && gupshupId) return gupshupId;
      return null;
    } catch {
      return null;
    }
  }

  private async sendWhatsApp(
    to: string,
    message: string,
    opts: SendOpts & {
      imageUrl?: string | null;
      cta?: { displayText: string; url: string } | null;
    } = {}
  ): Promise<void> {
    const business = opts.business;
    const businessId = business?.id as string | undefined;
    const category = opts.category || 'UTILITY';
    const toDigits = this.normalizeWhatsappDestination(to);
    if (!toDigits) {
      if (opts.throwOnError) throw new Error('WhatsApp destination number is invalid');
      return;
    }
    if (!businessId) {
      console.log('WhatsApp skipped: no business context for message');
      return;
    }

    const [tenantConfig, costPaise] = await Promise.all([
      prisma.whatsAppConfig.findUnique({ where: { businessId } }),
      whatsappPricingService.getPricePaise(category),
    ]);
    const platform = resolveWhatsappCredentials(business, tenantConfig);
    if (!platform) {
      await this.logWhatsAppMessage(businessId, opts, toDigits, category, 0, 'SKIPPED_NOT_CONFIGURED',
        'WhatsApp not available (platform WhatsApp missing or salon has not enabled WhatsApp)');
      const err = new Error('WhatsApp: enable WhatsApp in Settings, or contact support if Reservly platform WhatsApp is offline.');
      console.log(err.message);
      if (opts.throwOnError) throw err;
      return;
    }
    if (costPaise == null) {
      await this.logWhatsAppMessage(businessId, opts, toDigits, category, 0, 'FAILED',
        `No active pricing row for category ${category}`);
      const err = new Error(`WhatsApp: no active pricing for category ${category}`);
      console.log(err.message);
      if (opts.throwOnError) throw err;
      return;
    }

    // Wallet gate — hard stop on insufficient credits: no provider call, no debit.
    const reserve = await walletService.reserve(businessId, costPaise, {
      description: `WhatsApp ${category} message to +${toDigits}`,
      referenceType: opts.bookingId ? 'booking' : opts.customerId ? 'customer' : undefined,
      referenceId: opts.bookingId || opts.customerId || undefined,
    });
    if (!reserve.ok) {
      await this.logWhatsAppMessage(businessId, opts, toDigits, category, 0, 'INSUFFICIENT_CREDITS',
        `Wallet ${reserve.reason}: ${costPaise} paise needed for ${category}`);
      console.log(`WhatsApp skipped for ${businessId}: ${reserve.reason} (${costPaise} paise needed)`);
      if (opts.throwOnInsufficient) {
        throw new Error('WhatsApp wallet has insufficient credits — please recharge');
      }
      return; // booking / flow unaffected
    }

    try {
      const { response, bodyText: initialBody } = await this.dispatchWhatsapp(platform, toDigits, message, category, opts);
      let bodyText = initialBody;

      if (!response.ok) {
        const err = new Error(`WhatsApp sending failed: ${bodyText}`);
        await walletService.releaseReservation(reserve.reservationId, err.message);
        await this.logWhatsAppMessage(businessId, opts, toDigits, category, costPaise, 'FAILED',
          bodyText.slice(0, 500), reserve.reservationId);
        console.error(err.message);
        if (opts.throwOnError) throw err;
        return;
      }

      if (!bodyText) {
        try { bodyText = await response.text(); } catch { /* provider id optional */ }
      }
      const providerMessageId = this.parseProviderMessageId(bodyText);
      await walletService.finalizeReservation(reserve.reservationId, providerMessageId);
      await this.logWhatsAppMessage(businessId, opts, toDigits, category, costPaise, 'ACCEPTED',
        null, reserve.reservationId, providerMessageId);
      console.log(`WhatsApp sent to ${to}`);
    } catch (error: any) {
      await walletService.releaseReservation(reserve.reservationId, error?.message || 'send failed');
      await this.logWhatsAppMessage(businessId, opts, toDigits, category, costPaise, 'FAILED',
        (error?.message || 'send failed').slice(0, 500), reserve.reservationId);
      console.error('WhatsApp sending failed:', error);
      if (opts.throwOnError) throw error;
    }
  }

  /** Send an OTP by email. Throws on delivery failure. When `business` is omitted, uses platform SMTP (owner auth). */
  async sendOtpEmail(to: string, code: string, businessName: string, business?: any): Promise<void> {
    const forOwnerAuth = business == null;
    const heading = forOwnerAuth ? 'Verify your email' : 'Verify your booking';
    const intro = forOwnerAuth
      ? `Your one-time verification code for <strong>${this.esc(businessName)}</strong> is:`
      : `Your one-time verification code for <strong>${this.esc(businessName)}</strong> is:`;
    await this.sendEmail(to, `Your verification code - ${businessName}`,
      `<h2>${heading}</h2>
      <p>${intro}</p>
      <p style="font-size:24px; font-weight:700; letter-spacing:4px;">${code}</p>
      <p style="color:#6B7280; font-size:13px;">This code expires in 10 minutes. Never share it.</p>`,
      { throwOnError: true, business }
    );
  }

  async sendBookingConfirmation(booking: any, business: any): Promise<void> {
    const tz = business.timezone || 'Asia/Kolkata';
    const dateStr = new Intl.DateTimeFormat('en-IN', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: tz,
    }).format(new Date(booking.date));
    const serviceName = this.esc(this.bookingServiceName(booking));
    const durationMin = booking.durationMinutesSnapshot
      ? `${booking.durationMinutesSnapshot} min`
      : '';
    const locHtml = this.locationHtml(business);
    // One-time manage/cancel link — customer reschedule remains disabled (405).
    const manageLink = booking.managementUrl
      ? `<p><a href="${this.esc(booking.managementUrl)}" style="display:inline-block; background:#7C3AED; color:#ffffff; padding:12px 20px; border-radius:8px; text-decoration:none; font-weight:600;">Cancel booking</a></p>`
      : '';

    const html = `
      <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #7C3AED;">Booking Confirmed!</h2>
        <p>Hi ${this.esc(booking.customerName)},</p>
        <p>Your appointment at <strong>${this.esc(business.name)}</strong> has been confirmed.</p>
        <div style="background: #F9FAFB; padding: 16px; border-radius: 12px; margin: 16px 0;">
          <p><strong>Service:</strong> ${serviceName}${durationMin ? ` (${durationMin})` : ''}</p>
          <p><strong>Date:</strong> ${dateStr}</p>
          <p><strong>Time:</strong> ${booking.startTime} - ${booking.endTime}</p>
          ${booking.staff ? `<p><strong>Staff:</strong> ${this.esc(booking.staff.name)}</p>` : ''}
          ${booking.finalPrice != null ? `<p><strong>Amount:</strong> ₹${booking.finalPrice}</p>` : ''}
        </div>
        ${locHtml}
        ${manageLink}
        <p style="color: #6B7280; font-size: 14px;">Booking Reference: ${this.esc(booking.id)}</p>
      </div>
    `;

    // Notify customer from the owner's SMTP / Meta WhatsApp sender.
    if (business.notifyCustomerEmail && booking.customerEmail) {
      await this.sendEmail(
        booking.customerEmail,
        `Booking Confirmed - ${this.esc(business.name)}`,
        html,
        { replyTo: business.ownerEmail || undefined, business }
      );
    }
    if (business.notifyCustomerWhatsapp && booking.customerPhone) {
      // Keep WhatsApp body plain/single-line: Gupshup templates put this in {{1}},
      // and Meta silently drops params with newlines, tabs, or often URLs/emoji spam.
      const plainService = this.bookingServiceName(booking);
      const body =
        `Your appointment at ${business.name} is confirmed for ${dateStr} at ${booking.startTime}. ` +
        `Service ${plainService}${durationMin ? ` (${durationMin})` : ''}. ` +
        `Booking reference ${booking.id}.`;
      await this.sendWhatsApp(booking.customerPhone, body, {
        business,
        bookingId: booking.id,
      });
    }

    if (business.notifyOwnerEmail) {
      await this.sendEmail(business.ownerEmail, `New Booking - ${this.esc(booking.customerName)}`,
        `<h2>New Booking at ${this.esc(business.name)}</h2>
        <p><strong>Customer:</strong> ${this.esc(booking.customerName)}</p>
        <p><strong>Phone:</strong> ${this.esc(booking.customerPhone)}</p>
        <p><strong>Service:</strong> ${serviceName}${durationMin ? ` (${durationMin})` : ''}</p>
        <p><strong>Date:</strong> ${dateStr}</p>
        <p><strong>Time:</strong> ${booking.startTime} - ${booking.endTime}</p>
        ${booking.staff ? `<p><strong>Staff:</strong> ${this.esc(booking.staff.name)}</p>` : ''}`,
        { business }
      );
    }
    if (business.notifyOwnerWhatsapp && business.ownerWhatsapp) {
      await this.sendWhatsApp(business.ownerWhatsapp,
        `📅 New Booking!\n\n${booking.customerName}\n📞 ${booking.customerPhone}\n💇 ${this.bookingServiceName(booking)}${booking.durationMinutesSnapshot ? ` (${booking.durationMinutesSnapshot} min)` : ''}\n🕐 ${dateStr} ${booking.startTime}-${booking.endTime}`,
        { business, bookingId: booking.id }
      );
    }
  }

  async sendBookingCancellation(booking: any, business: any, refund: any = null): Promise<void> {
    const dateStr = new Date(booking.date).toLocaleDateString('en-IN', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    const serviceName = this.bookingServiceName(booking);
    const serviceHtml = this.esc(serviceName);

    // ONE customer message whose content branches on the durable refund state.
    let customerRefundCopy = '';
    if (refund && refund.status === 'FAILED') {
      customerRefundCopy = `<p style="color:#B45309; background:#FEF3C7; border:1px solid #FCD34D; border-radius:8px; padding:12px;">
        Booking cancelled, but the automatic refund needs the salon to complete it. We have notified the salon.
      </p>`;
    } else if (refund && refund.amount > 0) {
      customerRefundCopy = `<p style="color:#047857; background:#D1FAE5; border:1px solid #6EE7B7; border-radius:8px; padding:12px;">
        Refund initiated to your original payment method. It may be instant; otherwise allow 5\u20137 working days.
      </p>`;
    }
    if (business.notifyCustomerEmail && booking.customerEmail) {
      await this.sendEmail(booking.customerEmail, `Booking Cancelled - ${business.name}`,
        `<h2 style="color: #EF4444;">Booking Cancelled</h2>
        <p>Hi ${booking.customerName},</p>
        <p>Your <strong>${serviceHtml}</strong> appointment at <strong>${business.name}</strong> on ${dateStr} at ${booking.startTime} has been cancelled.</p>
        ${customerRefundCopy}
        <p style="color: #6B7280; font-size: 13px;">Booking ID: ${booking.id}</p>`,
        { business }
      );
    }
    if (business.notifyCustomerWhatsapp && booking.customerPhone) {
      await this.sendWhatsApp(booking.customerPhone,
        `❌ Booking cancelled\n\n${business.name}\n💇 ${serviceName}\n📅 ${dateStr} at ${booking.startTime}${refund && refund.amount > 0 ? `\n↩️ Refund: ${refund.status} (₹${refund.amount})` : ''}`,
        { business, bookingId: booking.id }
      );
    }

    // ONE owner message: paid amount + durable refund state + manual-action
    // warning when applicable.
    const refundLine = refund
      ? `<p><strong>Refund:</strong> ₹${refund.amount} · status ${refund.status}${refund.razorpayRefundId ? ` · Razorpay refund ${refund.razorpayRefundId}` : ''}</p>`
      : '';
    const manualAction = refund && refund.status === 'FAILED'
      ? '<p style="color:#DC2626;"><strong>Action needed:</strong> the automatic refund failed. Please initiate the refund manually from your Razorpay dashboard.</p>'
      : '';
    if (business.notifyOwnerEmail) {
      await this.sendEmail(business.ownerEmail, `Booking Cancelled - ${booking.customerName}`,
        `<h2>Booking Cancelled</h2>
        <p>${booking.customerName}'s <strong>${serviceHtml}</strong> booking on ${dateStr} at ${booking.startTime} has been cancelled.</p>
        ${booking.paymentAmount ? `<p><strong>Paid amount:</strong> ₹${booking.paymentAmount}</p>` : ''}
        ${refundLine}
        ${manualAction}`,
        { business }
      );
    }
    if (business.notifyOwnerWhatsapp && business.ownerWhatsapp) {
      await this.sendWhatsApp(business.ownerWhatsapp,
        `❌ Booking cancelled\n\n${booking.customerName}\n💇 ${serviceName}\n📅 ${dateStr} at ${booking.startTime}${booking.paymentAmount ? `\n💰 Paid: ₹${booking.paymentAmount}` : ''}${refund ? `\n↩️ Refund: ${refund.status} (₹${refund.amount})` : ''}${refund && refund.status === 'FAILED' ? '\n⚠️ Manual action needed — refund failed.' : ''}`,
        { business, bookingId: booking.id }
      );
    }
  }

  async sendBookingUpdate(booking: any, business: any, changes: any): Promise<void> {
    const dateStr = new Date(booking.date).toLocaleDateString('en-IN', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    const serviceName = this.bookingServiceName(booking);
    if (business.notifyCustomerEmail && booking.customerEmail) {
      await this.sendEmail(booking.customerEmail, `Booking Updated - ${business.name}`,
        `<h2>Booking Updated</h2>
        <p>Hi ${booking.customerName},</p>
        <p>Your <strong>${this.esc(serviceName)}</strong> booking at <strong>${business.name}</strong> has been updated.</p>
        <p><strong>Service:</strong> ${this.esc(serviceName)}</p>
        <p><strong>Date:</strong> ${dateStr}</p>
        <p><strong>Time:</strong> ${booking.startTime} - ${booking.endTime}</p>`,
        { business }
      );
    }
  }

  async sendWaitlistJoined(entry: any, business: any): Promise<void> {
    if (entry.customerEmail) {
      await this.sendEmail(entry.customerEmail, `Added to Waitlist - ${business.name}`,
        `<h2>You're on the Waitlist!</h2>
        <p>Hi ${entry.customerName},</p>
        <p>You've been added to the waitlist for ${business.name}.</p>
        <p>We'll notify you if a slot opens up.</p>`,
        { business }
      );
    }
  }

  async sendWaitlistOpened(entry: any, business: any, bookingLink: string): Promise<void> {
    const dateStr = new Date(entry.date).toLocaleDateString('en-IN', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    if (entry.customerEmail) {
      await this.sendEmail(entry.customerEmail, `Slot Available! - ${business.name}`,
        `<h2 style="color: #10B981;">A Slot Just Opened!</h2>
        <p>Hi ${entry.customerName},</p>
        <p>A slot is now available at <strong>${business.name}</strong> on ${dateStr} at ${entry.startTime}.</p>
        <p>You have <strong>30 minutes</strong> to book this slot.</p>
        <a href="${bookingLink}" style="background: #7C3AED; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block;">Book Now</a>`,
        { business }
      );
    }
    if (entry.customerPhone) {
      await this.sendWhatsApp(entry.customerPhone,
        `🎉 A slot just opened!\n\n${business.name}\n📅 ${dateStr}\n🕐 ${entry.startTime}\n\nBook within 30 minutes:\n${bookingLink}`,
        { business }
      );
    }
  }

  async sendWaitlistExpired(entry: any, business: any): Promise<void> {
    if (entry.customerEmail) {
      await this.sendEmail(entry.customerEmail, `Waitlist Expired - ${business.name}`,
        `<h2>Waitlist Slot Expired</h2>
        <p>The slot that opened up at ${business.name} has expired. You've been removed from the waitlist.</p>`,
        { business }
      );
    }
  }

  async sendRecurringSeriesConfirmation(bookings: any[], business: any): Promise<void> {
    if (bookings.length === 0) return;
    const first = bookings[0];
    const dates = bookings.map(b => new Date(b.date).toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' })).join(', ');

    if (business.notifyCustomerEmail && first.customerEmail) {
      await this.sendEmail(first.customerEmail, `Recurring Booking Confirmed - ${business.name}`,
        `<h2>Recurring Booking Confirmed! 🔄</h2>
        <p>Hi ${first.customerName},</p>
        <p>Your recurring booking at <strong>${business.name}</strong> has been confirmed for ${bookings.length} sessions.</p>
        <p><strong>Dates:</strong> ${dates}</p>
        <p><strong>Time:</strong> ${first.startTime} - ${first.endTime}</p>`,
        { business }
      );
    }
  }

  async sendRecurringSeriesCancellation(bookings: any[], business: any): Promise<void> {
    if (bookings.length === 0) return;
    const first = bookings[0];

    if (business.notifyCustomerEmail && first.customerEmail) {
      await this.sendEmail(first.customerEmail, `Recurring Booking Cancelled - ${business.name}`,
        `<h2>Recurring Booking Cancelled</h2>
        <p>Hi ${first.customerName},</p>
        <p>Your recurring booking series at <strong>${business.name}</strong> (${bookings.length} sessions) has been cancelled.</p>`,
        { business }
      );
    }
  }

  async sendRecurringReminder(booking: any, business: any): Promise<void> {
    const dateStr = new Date(booking.date).toLocaleDateString('en-IN', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    if (business.notifyCustomerEmail && booking.customerEmail) {
      await this.sendEmail(booking.customerEmail, `Reminder: Appointment Tomorrow - ${business.name}`,
        `<h2>Appointment Reminder 🔔</h2>
        <p>Hi ${booking.customerName},</p>
        <p>This is a reminder for your appointment at <strong>${business.name}</strong> tomorrow.</p>
        <p><strong>Date:</strong> ${dateStr}</p>
        <p><strong>Time:</strong> ${booking.startTime} - ${booking.endTime}</p>`,
        { business }
      );
    }
  }

  async sendPaymentReceipt(booking: any, business: any): Promise<void> {
    const dateStr = new Date(booking.date).toLocaleDateString('en-IN', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    if (booking.customerEmail) {
      await this.sendEmail(booking.customerEmail, `Payment Receipt - ${business.name}`,
        `<h2>Payment Receipt 💳</h2>
        <p>Hi ${booking.customerName},</p>
        <p>Payment received for your appointment at <strong>${business.name}</strong>.</p>
        <div style="background: #F9FAFB; padding: 16px; border-radius: 12px; margin: 16px 0;">
          <p><strong>Amount:</strong> ₹${booking.paymentAmount}</p>
          <p><strong>Date:</strong> ${dateStr}</p>
          <p><strong>Time:</strong> ${booking.startTime} - ${booking.endTime}</p>
          <p><strong>Transaction ID:</strong> ${booking.razorpayPaymentId}</p>
        </div>`,
        { business }
      );
    }
  }

  /**
   * Customer message after an automatic refund was initiated/processed.
   * Accurate timing: instant where the network supports it, otherwise the
   * normal banking timeline — never promise a fixed 1-2 day SLA.
   */
  /**
   * Single refund notification for the owner manual-refund flow (booking is
   * not necessarily cancelled). One customer message + one owner message,
   * branching on the durable refund state. Never claims a refund succeeded
   * when it did not.
   */
  async sendPaymentRefundConfirmation(booking: any, business: any, refund: any = null): Promise<void> {
    const amount = refund?.amount ?? booking.paymentAmount;
    const failed = refund?.status === 'FAILED';
    const subject = failed ? `Refund Needs Attention - ${business.name}` : `Refund Initiated - ${business.name}`;

    if (business.notifyCustomerEmail && booking.customerEmail) {
      const body = failed
        ? `<h2>Refund Needs Action</h2>
        <p>Hi ${booking.customerName},</p>
        <p>A refund of ₹${amount} for your booking at <strong>${business.name}</strong> could not be completed automatically.</p>
        <p><strong>The salon has been notified</strong> and will complete it to your original payment method. It may be instant; otherwise allow 5\u20137 working days.</p>`
        : `<h2>Refund Initiated</h2>
        <p>Hi ${booking.customerName},</p>
        <p>A refund of ₹${amount} for your booking at <strong>${business.name}</strong> has been initiated to your original payment method.</p>
        <p>It may be instant; otherwise allow 5\u20137 working days.</p>`;
      await this.sendEmail(booking.customerEmail, subject, body, { business });
    }

    if (business.notifyOwnerEmail) {
      await this.sendEmail(business.ownerEmail, `Refund ${failed ? 'Failed - Manual Action Needed' : 'Initiated'} - ${booking.customerName}`,
        `<h2>${failed ? '⚠️ Automatic Refund Failed' : 'Refund Initiated'}</h2>
        <p><strong>Booking ID:</strong> ${booking.id}</p>
        <p><strong>Customer:</strong> ${booking.customerName}</p>
        <p><strong>Amount:</strong> ₹${amount}</p>
        ${refund?.razorpayRefundId ? `<p><strong>Razorpay refund:</strong> ${refund.razorpayRefundId}</p>` : ''}
        ${failed && refund?.failureReason ? `<p><strong>Reason:</strong> ${refund.failureReason}</p>` : ''}
        ${failed ? '<p>Please initiate the refund manually from your Razorpay dashboard.</p>' : ''}`,
        { business }
      );
    }
    if (business.notifyOwnerWhatsapp && business.ownerWhatsapp) {
      await this.sendWhatsApp(business.ownerWhatsapp,
        failed
          ? `⚠️ Refund failed for booking ${booking.id} (${booking.customerName}, ₹${amount}). Manual action needed: ${refund?.failureReason || 'Unknown reason'}`
          : `↩️ Refund initiated for booking ${booking.id} (${booking.customerName}, ₹${amount}).`,
        { business, bookingId: booking.id }
      );
    }
  }

  /**
   * Send a reminder for a booking over one channel.
   * Failure must never throw into the caller (sending is best-effort).
   */
  async sendReminder(booking: any, business: any, channel: 'email' | 'whatsapp'): Promise<void> {
    const serviceName = this.esc(this.bookingServiceName(booking));
    const subject = `Reminder: ${serviceName} at ${this.esc(business.name)}`;
    const line = `${booking.dateDisplay} at ${booking.startTime}${booking.endTime ? ` - ${booking.endTime}` : ''}`;
    // Reminders intentionally carry location/directions ONLY — the manage/cancel
    // token is returned exactly once at booking creation and is never recreated.
    const locHtml = this.locationHtml(business);
    const { address, directions } = this.locationText(business);

    if (channel === 'email') {
      if (booking.customerEmail) {
        await this.sendEmail(booking.customerEmail, subject,
          `<h2>Appointment Reminder 🔔</h2>
          <p>Hi ${this.esc(booking.customerName)},</p>
          <p>This is a reminder for your ${serviceName} at <strong>${this.esc(business.name)}</strong>.</p>
          <div style="background: #F9FAFB; padding: 16px; border-radius: 12px; margin: 16px 0;">
            <p><strong>Service:</strong> ${serviceName}</p>
            <p><strong>Date:</strong> ${booking.dateDisplay}</p>
            <p><strong>Time:</strong> ${booking.startTime}${booking.endTime ? ` - ${booking.endTime}` : ''}</p>
            ${booking.staff?.name ? `<p><strong>Staff:</strong> ${this.esc(booking.staff.name)}</p>` : ''}
            ${booking.finalPrice != null ? `<p><strong>Amount:</strong> ₹${booking.finalPrice}</p>` : ''}
          </div>
          ${locHtml}
          <p style="color: #6B7280; font-size: 14px;">Booking Reference: ${this.esc(booking.id)}</p>`,
          { business }
        );
      }
    } else if (channel === 'whatsapp' && booking.customerPhone) {
      await this.sendWhatsApp(booking.customerPhone,
        `🔔 Reminder for your ${serviceName}\n\n${this.esc(business.name)}\n📅 ${booking.dateDisplay}\n🕐 ${line}${booking.staff?.name ? `\n👤 ${this.esc(booking.staff.name)}` : ''}${booking.finalPrice != null ? `\n💰 ₹${booking.finalPrice}` : ''}\n${address}${directions}\n\nBooking Ref: ${this.esc(booking.id)}`,
        { business, bookingId: booking.id, throwOnInsufficient: true }
      );
    }
  }

  /**
   * Owner-authored message to one phonebook contact. Delivery uses the owner's
   * SMTP credentials and Reservly's shared WhatsApp (wallet billed as MARKETING).
   */
  async sendCustomCustomerNotification(
    businessId: string,
    customerId: string,
    channels: Array<'email' | 'whatsapp'>,
    subject: string,
    message: string,
    messageHtml?: string | null,
    imageUrl?: string | null
  ): Promise<Array<{ channel: 'email' | 'whatsapp'; ok: boolean; error?: string }>> {
    const [business, customer] = await Promise.all([
      prisma.business.findUnique({ where: { id: businessId } }),
      prisma.customerContact.findFirst({ where: { id: customerId, businessId } }),
    ]);
    if (!business) throw new Error('Business not found');
    if (!customer) throw new Error('Customer not found');

    const plainMessage = htmlToPlainText(messageHtml || message);
    const publicImageUrl = this.absolutePublicUrl(imageUrl || '');
    const emailBody = wrapEmailMessage(
      business.name,
      messageHtml || message,
      (v) => this.esc(v),
      publicImageUrl
    );
    const historyMessage = plainMessage.slice(0, 3000);

    const results: Array<{ channel: 'email' | 'whatsapp'; ok: boolean; error?: string }> = [];
    for (const channel of channels) {
      let ok = false;
      let error: string | undefined;
      try {
        if (channel === 'email') {
          if (!customer.email) throw new Error('Customer does not have an email address');
          await this.sendEmail(
            customer.email,
            subject,
            emailBody,
            { replyTo: business.ownerEmail, throwOnError: true, business }
          );
        } else {
          if (!customer.phone) throw new Error('Customer does not have a phone number');
          const ownerContact = business.ownerWhatsapp
            ? `\n\nReply/contact: https://wa.me/${String(business.ownerWhatsapp).replace(/\D/g, '')}`
            : '';
          await this.sendWhatsApp(
            customer.phone,
            `${business.name}\n\n${plainMessage}${ownerContact}`,
            {
              throwOnError: true,
              throwOnInsufficient: true,
              business,
              imageUrl: publicImageUrl,
              customerId: customer.id,
              category: 'MARKETING',
            }
          );
        }
        ok = true;
      } catch (e: any) {
        error = e?.message || `${channel} delivery failed`;
      }

      await prisma.customerNotification.create({
        data: {
          businessId,
          customerId: customer.id,
          channel,
          subject: channel === 'email' ? subject : null,
          message: historyMessage,
          recipientName: customer.name,
          recipientEmail: customer.email,
          recipientPhone: customer.phone,
          status: ok ? 'SENT' : 'FAILED',
          error,
          sentAt: ok ? new Date() : null,
        },
      });
      results.push({ channel, ok, ...(error ? { error } : {}) });
    }
    return results;
  }

  async sendBroadcast(
    businessId: string,
    subject: string,
    message: string,
    filters?: {
      service?: string | null;
      attributes?: Record<string, string> | null;
    } | null,
    messageHtml?: string | null,
    channelsWanted: Array<'email' | 'whatsapp'> = ['email', 'whatsapp'],
    imageUrl?: string | null
  ): Promise<{
    total: number;
    matched: number;
    emailed: number;
    whatsapped: number;
    reached: number;
    unsent: Array<{ id: string; name: string; email: string | null; phone: string | null; reason: string }>;
    ownerNotified: boolean;
  }> {
    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new Error('Business not found');

    const wanted = [...new Set(channelsWanted)];
    if (wanted.length === 0) throw new Error('Choose email or WhatsApp');

    const allCustomers = await prisma.customerContact.findMany({
      where: { businessId },
      orderBy: { name: 'asc' },
      take: 500,
    });
    const customers = allCustomers.filter((customer) => contactMatchesFilters(customer, filters));
    if (allCustomers.length === 0) throw new Error('There are no customers in the phonebook yet');
    if (customers.length === 0) throw new Error('No customers match the selected filters');

    const smtpReady = this.smtpConfigured(business);
    const whatsappReady = this.metaWhatsappConfigured(business);
    const unsent: Array<{ id: string; name: string; email: string | null; phone: string | null; reason: string }> = [];
    let emailed = 0;
    let whatsapped = 0;
    let reached = 0;

    const queue = [...customers];
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length > 0) {
        const customer = queue.shift();
        if (!customer) return;
        const canEmail = isValidNotifyEmail(customer.email);
        const canWhatsapp = isValidWhatsappNumber(customer.phone);
        const reasons: string[] = [];
        const channels: Array<'email' | 'whatsapp'> = [];

        if (wanted.includes('email')) {
          if (canEmail) {
            if (smtpReady) channels.push('email');
            else reasons.push('email not sent — SMTP is not configured');
          } else if (customer.email) {
            reasons.push(`email not sent — invalid address (${customer.email})`);
          } else {
            reasons.push('email not sent — no email saved');
          }
        }

        if (wanted.includes('whatsapp')) {
          if (canWhatsapp) {
            if (whatsappReady) channels.push('whatsapp');
            else reasons.push('WhatsApp not sent — platform WhatsApp is not configured');
          } else if (customer.phone) {
            reasons.push(`WhatsApp not sent — invalid number (${customer.phone})`);
          } else {
            reasons.push('WhatsApp not sent — no number saved');
          }
        }

        if (channels.length === 0) {
          unsent.push({
            id: customer.id,
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
            reason: reasons.join('; '),
          });
          continue;
        }

        const results = await this.sendCustomCustomerNotification(
          businessId,
          customer.id,
          channels,
          subject,
          message,
          messageHtml,
          imageUrl
        );
        const gotEmail = results.some((r) => r.channel === 'email' && r.ok);
        const gotWhatsapp = results.some((r) => r.channel === 'whatsapp' && r.ok);
        if (gotEmail) emailed += 1;
        if (gotWhatsapp) whatsapped += 1;
        if (gotEmail || gotWhatsapp) reached += 1;
        else {
          const failed = results.filter((r) => !r.ok).map((r) => `${r.channel} failed — ${r.error || 'delivery failed'}`);
          unsent.push({
            id: customer.id,
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
            reason: [...reasons, ...failed].join('; '),
          });
        }
      }
    });
    await Promise.all(workers);

    let ownerNotified = false;
    if (unsent.length > 0 && business.ownerEmail && smtpReady) {
      const rows = unsent.map((person) =>
        `<tr>
          <td style="padding:6px 10px;border-bottom:1px solid #E5E7EB;">${this.esc(person.name)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #E5E7EB;">${this.esc(person.email || '—')}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #E5E7EB;">${this.esc(person.phone || '—')}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #E5E7EB;">${this.esc(person.reason)}</td>
        </tr>`
      ).join('');
      try {
        await this.sendEmail(
          business.ownerEmail,
          `Broadcast incomplete — ${unsent.length} customer${unsent.length === 1 ? '' : 's'} were not sent`,
          `<h2>These customers were not sent your message</h2>
          <p>Your broadcast from <strong>${this.esc(business.name)}</strong> reached ${reached} of ${customers.length} matched customers.</p>
          <p>The people below had no valid email/WhatsApp number, or delivery failed:</p>
          <table style="border-collapse:collapse;font-size:14px;">
            <thead>
              <tr>
                <th style="text-align:left;padding:6px 10px;">Name</th>
                <th style="text-align:left;padding:6px 10px;">Email</th>
                <th style="text-align:left;padding:6px 10px;">WhatsApp</th>
                <th style="text-align:left;padding:6px 10px;">Reason</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>`,
          { throwOnError: true, business }
        );
        ownerNotified = true;
      } catch (e: any) {
        console.error('Broadcast owner digest failed:', e?.message || e);
      }
    }

    return { total: allCustomers.length, matched: customers.length, emailed, whatsapped, reached, unsent, ownerNotified };
  }

  /**
   * Readiness-oriented test send. Reports REAL per-channel success/failure with
   * a clear reason (owner SMTP/Meta config, owner destination presence).
   */
  async sendTestNotification(businessId: string): Promise<{ email: { ok: boolean; error?: string }; whatsapp: { ok: boolean; error?: string } }> {
    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new Error('Business not found');

    const email = { ok: false, error: undefined as string | undefined };
    const whatsapp = { ok: false, error: undefined as string | undefined };

    if (!this.smtpConfigured(business)) {
      email.error = 'SMTP is not configured. Add your email username and password in Settings.';
    } else {
      try {
        await this.sendEmail(
          business.ownerEmail,
          `Test Notification - ${this.esc(business.name)}`,
          `<h2>Test Notification ✅</h2><p>Your notification system is working correctly!</p>`,
          { throwOnError: true, business }
        );
        email.ok = true;
      } catch (e: any) {
        email.error = e?.message || 'Email sending failed';
      }
    }

    const whatsappConfig = await prisma.whatsAppConfig.findUnique({ where: { businessId } });
    if (!resolveWhatsappCredentials(business, whatsappConfig)) {
      whatsapp.error = 'WhatsApp is not enabled for this salon, or Reservly platform WhatsApp is offline. Use Settings → Enable WhatsApp.';
    } else if (!business.ownerWhatsapp) {
      whatsapp.error = 'Owner WhatsApp number is not set';
    } else {
      try {
        await this.sendWhatsApp(
          business.ownerWhatsapp,
          `✅ Test notification from ${business.name}. Your notification system is working!`,
          { throwOnError: true, throwOnInsufficient: true, business }
        );
        whatsapp.ok = true;
      } catch (e: any) {
        whatsapp.error = e?.message || 'WhatsApp sending failed';
      }
    }

    return { email, whatsapp };
  }
}

export const notificationService = new NotificationService();