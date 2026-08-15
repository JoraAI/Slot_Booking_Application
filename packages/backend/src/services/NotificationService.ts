import nodemailer from 'nodemailer';
import prisma from '../lib/prisma';
import { locationInfo } from './LocationService';

class NotificationService {
  private transporter: nodemailer.Transporter | null = null;

  /** HTML-escape user-controlled values interpolated into email templates. */
  private esc(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
    ));
  }

  smtpConfigured(): boolean {
    return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
  }

  twilioWhatsappConfigured(): boolean {
    return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM);
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

  private getTransporter() {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    }
    return this.transporter;
  }

  private async sendEmail(to: string, subject: string, html: string, opts: { replyTo?: string; throwOnError?: boolean } = {}): Promise<void> {
    try {
      const transporter = this.getTransporter();
      await transporter.sendMail({
        from: `"${process.env.SMTP_FROM_NAME || 'Reservly'}" <${process.env.SMTP_USER}>`,
        to,
        subject,
        html,
        ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
      });
      console.log(`Email sent to ${to}: ${subject}`);
    } catch (error) {
      console.error('Email sending failed:', error);
      // Readiness / test-send paths need to surface real failures.
      if (opts.throwOnError) throw error;
    }
  }

  private async sendWhatsApp(to: string, message: string, opts: { throwOnError?: boolean } = {}): Promise<void> {
    // Twilio WhatsApp API integration stub
    try {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const from = process.env.TWILIO_WHATSAPP_FROM;

      if (!accountSid || !authToken || !from) {
        const err = new Error('WhatsApp: Missing Twilio config (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM)');
        console.log(err.message);
        if (opts.throwOnError) throw err;
        return;
      }

      const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          From: from,
          To: `whatsapp:${to}`,
          Body: message,
        }),
      });

      if (!response.ok) {
        const err = new Error(`WhatsApp sending failed: ${await response.text()}`);
        console.error(err.message);
        if (opts.throwOnError) throw err;
      } else {
        console.log(`WhatsApp sent to ${to}`);
      }
    } catch (error) {
      console.error('WhatsApp sending failed:', error);
      if (opts.throwOnError) throw error;
    }
  }

  /** Twilio SMS (plain SMS, not WhatsApp) using TWILIO_SMS_FROM. */
  private async sendSms(to: string, message: string): Promise<void> {
    try {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const from = process.env.TWILIO_SMS_FROM;

      if (!accountSid || !authToken || !from) {
        throw new Error('SMS: Missing Twilio SMS configuration (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_SMS_FROM)');
      }

      const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          From: from,
          To: to,
          Body: message,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        console.error('SMS sending failed:', body);
        throw new Error('SMS sending failed');
      } else {
        console.log(`SMS sent to ${to}`);
      }
    } catch (error) {
      console.error('SMS sending failed:', error);
      throw error;
    }
  }

  /** Send a booking-management OTP by email. Throws on delivery failure. */
  async sendOtpEmail(to: string, code: string, businessName: string): Promise<void> {
    await this.sendEmail(to, `Your verification code - ${businessName}`,
      `<h2>Verify your booking</h2>
      <p>Your one-time verification code for <strong>${businessName}</strong> is:</p>
      <p style="font-size:24px; font-weight:700; letter-spacing:4px;">${code}</p>
      <p style="color:#6B7280; font-size:13px;">This code expires in 10 minutes. Never share it.</p>`
    );
  }

  /** Send a booking-management OTP by SMS. Throws on delivery failure. */
  async sendOtpSms(to: string, code: string, businessName: string): Promise<void> {
    await this.sendSms(to, `Your ${businessName} booking verification code is: ${code}. It expires in 10 minutes.`);
  }

  async sendBookingConfirmation(booking: any, business: any): Promise<void> {
    const tz = business.timezone || 'Asia/Kolkata';
    const dateStr = new Intl.DateTimeFormat('en-IN', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: tz,
    }).format(new Date(booking.date));
    const serviceName = this.esc(booking.serviceNameSnapshot || 'Appointment');
    const durationMin = booking.durationMinutesSnapshot
      ? `${booking.durationMinutesSnapshot} min`
      : '';
    const locHtml = this.locationHtml(business);
    // One-time manage/cancel link — customer reschedule remains disabled (405).
    const manageLink = booking.managementUrl
      ? `<p><a href="${this.esc(booking.managementUrl)}" style="display:inline-block; background:#7C3AED; color:#ffffff; padding:12px 20px; border-radius:8px; text-decoration:none; font-weight:600;">View or cancel booking</a></p>`
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

    // Notify customer (platform SMTP From; salon ownerEmail as replyTo).
    if (business.notifyCustomerEmail && booking.customerEmail) {
      await this.sendEmail(
        booking.customerEmail,
        `Booking Confirmed - ${this.esc(business.name)}`,
        html,
        { replyTo: business.ownerEmail || undefined }
      );
    }
    if (business.notifyCustomerWhatsapp && booking.customerPhone) {
      const { address, directions, contact } = this.locationText(business);
      await this.sendWhatsApp(booking.customerPhone,
        `✅ Booking Confirmed!\n\n${this.esc(business.name)}\n💇 ${serviceName}${durationMin ? ` (${durationMin})` : ''}\n📅 ${dateStr}\n🕐 ${booking.startTime} - ${booking.endTime}\n${booking.staff ? `👤 ${this.esc(booking.staff.name)}\n` : ''}${booking.finalPrice != null ? `💰 ₹${booking.finalPrice}\n` : ''}${address}${directions}${contact}${booking.managementUrl ? `\nManage booking: ${booking.managementUrl}` : ''}\nBooking Reference: ${this.esc(booking.id)}`
      );
    }

    // Notify owner (platform sender; never the salon number as Twilio From).
    if (business.notifyOwnerEmail) {
      await this.sendEmail(business.ownerEmail, `New Booking - ${this.esc(booking.customerName)}`,
        `<h2>New Booking at ${this.esc(business.name)}</h2>
        <p><strong>Customer:</strong> ${this.esc(booking.customerName)}</p>
        <p><strong>Phone:</strong> ${this.esc(booking.customerPhone)}</p>
        <p><strong>Date:</strong> ${dateStr}</p>
        <p><strong>Time:</strong> ${booking.startTime} - ${booking.endTime}</p>
        ${booking.staff ? `<p><strong>Staff:</strong> ${this.esc(booking.staff.name)}</p>` : ''}`
      );
    }
    if (business.notifyOwnerWhatsapp && business.ownerWhatsapp) {
      await this.sendWhatsApp(business.ownerWhatsapp,
        `📅 New Booking!\n\n${booking.customerName}\n📞 ${booking.customerPhone}\n🕐 ${dateStr} ${booking.startTime}-${booking.endTime}`
      );
    }
  }

  async sendBookingCancellation(booking: any, business: any, refund: any = null): Promise<void> {
    const dateStr = new Date(booking.date).toLocaleDateString('en-IN', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

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
        <p>Your appointment at <strong>${business.name}</strong> on ${dateStr} at ${booking.startTime} has been cancelled.</p>
        ${customerRefundCopy}
        <p style="color: #6B7280; font-size: 13px;">Booking ID: ${booking.id}</p>`
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
        <p>${booking.customerName}'s booking on ${dateStr} at ${booking.startTime} has been cancelled.</p>
        ${booking.paymentAmount ? `<p><strong>Paid amount:</strong> ₹${booking.paymentAmount}</p>` : ''}
        ${refundLine}
        ${manualAction}`
      );
    }
    if (business.notifyOwnerWhatsapp && business.ownerWhatsapp) {
      await this.sendWhatsApp(business.ownerWhatsapp,
        `❌ Booking cancelled\n\n${booking.customerName}\n📅 ${dateStr} at ${booking.startTime}${booking.paymentAmount ? `\n💰 Paid: ₹${booking.paymentAmount}` : ''}${refund ? `\n↩️ Refund: ${refund.status} (₹${refund.amount})` : ''}${refund && refund.status === 'FAILED' ? '\n⚠️ Manual action needed — refund failed.' : ''}`
      );
    }
  }

  async sendBookingUpdate(booking: any, business: any, changes: any): Promise<void> {
    const dateStr = new Date(booking.date).toLocaleDateString('en-IN', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    if (business.notifyCustomerEmail && booking.customerEmail) {
      await this.sendEmail(booking.customerEmail, `Booking Updated - ${business.name}`,
        `<h2>Booking Updated</h2>
        <p>Hi ${booking.customerName},</p>
        <p>Your booking at <strong>${business.name}</strong> has been updated.</p>
        <p><strong>Date:</strong> ${dateStr}</p>
        <p><strong>Time:</strong> ${booking.startTime} - ${booking.endTime}</p>`
      );
    }
  }

  async sendWaitlistJoined(entry: any, business: any): Promise<void> {
    if (entry.customerEmail) {
      await this.sendEmail(entry.customerEmail, `Added to Waitlist - ${business.name}`,
        `<h2>You're on the Waitlist!</h2>
        <p>Hi ${entry.customerName},</p>
        <p>You've been added to the waitlist for ${business.name}.</p>
        <p>We'll notify you if a slot opens up.</p>`
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
        <a href="${bookingLink}" style="background: #7C3AED; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block;">Book Now</a>`
      );
    }
    if (entry.customerPhone) {
      await this.sendWhatsApp(entry.customerPhone,
        `🎉 A slot just opened!\n\n${business.name}\n📅 ${dateStr}\n🕐 ${entry.startTime}\n\nBook within 30 minutes:\n${bookingLink}`
      );
    }
  }

  async sendWaitlistExpired(entry: any, business: any): Promise<void> {
    if (entry.customerEmail) {
      await this.sendEmail(entry.customerEmail, `Waitlist Expired - ${business.name}`,
        `<h2>Waitlist Slot Expired</h2>
        <p>The slot that opened up at ${business.name} has expired. You've been removed from the waitlist.</p>`
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
        <p><strong>Time:</strong> ${first.startTime} - ${first.endTime}</p>`
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
        <p>Your recurring booking series at <strong>${business.name}</strong> (${bookings.length} sessions) has been cancelled.</p>`
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
        <p><strong>Time:</strong> ${booking.startTime} - ${booking.endTime}</p>`
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
        </div>`
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
      await this.sendEmail(booking.customerEmail, subject, body);
    }

    if (business.notifyOwnerEmail) {
      await this.sendEmail(business.ownerEmail, `Refund ${failed ? 'Failed - Manual Action Needed' : 'Initiated'} - ${booking.customerName}`,
        `<h2>${failed ? '⚠️ Automatic Refund Failed' : 'Refund Initiated'}</h2>
        <p><strong>Booking ID:</strong> ${booking.id}</p>
        <p><strong>Customer:</strong> ${booking.customerName}</p>
        <p><strong>Amount:</strong> ₹${amount}</p>
        ${refund?.razorpayRefundId ? `<p><strong>Razorpay refund:</strong> ${refund.razorpayRefundId}</p>` : ''}
        ${failed && refund?.failureReason ? `<p><strong>Reason:</strong> ${refund.failureReason}</p>` : ''}
        ${failed ? '<p>Please initiate the refund manually from your Razorpay dashboard.</p>' : ''}`
      );
    }
    if (business.notifyOwnerWhatsapp && business.ownerWhatsapp) {
      await this.sendWhatsApp(business.ownerWhatsapp,
        failed
          ? `⚠️ Refund failed for booking ${booking.id} (${booking.customerName}, ₹${amount}). Manual action needed: ${refund?.failureReason || 'Unknown reason'}`
          : `↩️ Refund initiated for booking ${booking.id} (${booking.customerName}, ₹${amount}).`
      );
    }
  }

  /**
   * Send a reminder for a booking over one channel.
   * Failure must never throw into the caller (sending is best-effort).
   */
  async sendReminder(booking: any, business: any, channel: 'email' | 'whatsapp'): Promise<void> {
    const serviceName = this.esc(booking.serviceNameSnapshot || 'Appointment');
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
            <p><strong>Date:</strong> ${booking.dateDisplay}</p>
            <p><strong>Time:</strong> ${booking.startTime}${booking.endTime ? ` - ${booking.endTime}` : ''}</p>
            ${booking.staff?.name ? `<p><strong>Staff:</strong> ${this.esc(booking.staff.name)}</p>` : ''}
            ${booking.finalPrice != null ? `<p><strong>Amount:</strong> ₹${booking.finalPrice}</p>` : ''}
          </div>
          ${locHtml}
          <p style="color: #6B7280; font-size: 14px;">Booking Reference: ${this.esc(booking.id)}</p>`
        );
      }
    } else if (channel === 'whatsapp' && booking.customerPhone) {
      await this.sendWhatsApp(booking.customerPhone,
        `🔔 Reminder for your ${serviceName}\n\n${this.esc(business.name)}\n📅 ${booking.dateDisplay}\n🕐 ${line}${booking.staff?.name ? `\n👤 ${this.esc(booking.staff.name)}` : ''}${booking.finalPrice != null ? `\n💰 ₹${booking.finalPrice}` : ''}\n${address}${directions}\n\nBooking Ref: ${this.esc(booking.id)}`
      );
    }
  }

  /**
   * Readiness-oriented test send. Reports REAL per-channel success/failure with
   * a clear reason (platform SMTP/Twilio config, owner destination presence).
   */
  async sendTestNotification(businessId: string): Promise<{ email: { ok: boolean; error?: string }; whatsapp: { ok: boolean; error?: string } }> {
    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new Error('Business not found');

    const email = { ok: false, error: undefined as string | undefined };
    const whatsapp = { ok: false, error: undefined as string | undefined };

    if (!this.smtpConfigured()) {
      email.error = 'SMTP is not configured (SMTP_USER / SMTP_PASS)';
    } else {
      try {
        await this.sendEmail(
          business.ownerEmail,
          `Test Notification - ${this.esc(business.name)}`,
          `<h2>Test Notification ✅</h2><p>Your notification system is working correctly!</p>`,
          { throwOnError: true }
        );
        email.ok = true;
      } catch (e: any) {
        email.error = e?.message || 'Email sending failed';
      }
    }

    if (!this.twilioWhatsappConfigured()) {
      whatsapp.error = 'Twilio WhatsApp is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM)';
    } else if (!business.ownerWhatsapp) {
      whatsapp.error = 'Owner WhatsApp number is not set';
    } else {
      try {
        await this.sendWhatsApp(
          business.ownerWhatsapp,
          `✅ Test notification from ${business.name}. Your notification system is working!`,
          { throwOnError: true }
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