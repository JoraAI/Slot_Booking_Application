import { decryptSecret } from './secretCrypto';

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
};

export type ResendConfig = {
  apiKey: string;
  from: string;
};

export type WhatsappProvider = 'meta' | 'twilio';

export type MetaWhatsappConfig = {
  provider: 'meta';
  phoneNumberId: string;
  accessToken: string;
  utilityTemplate?: string;
  marketingTemplate?: string;
  displayPhone?: string;
};

export type TwilioWhatsappConfig = {
  provider: 'twilio';
  accountSid: string;
  authToken: string;
  /** E.164 or whatsapp:+E.164 — normalized with whatsapp: prefix at send time. */
  from: string;
  utilityContentSid?: string;
  marketingContentSid?: string;
  displayPhone?: string;
};

export type WhatsappPlatformConfig = MetaWhatsappConfig | TwilioWhatsappConfig;

export type TenantWhatsAppConfig = {
  status?: string | null;
  enabled?: boolean | null;
  connectionMode?: string | null;
} | null | undefined;

type DeliveryBusiness = {
  name?: string | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure?: boolean | null;
  smtpUser?: string | null;
  smtpPassEnc?: string | null;
  smtpFromName?: string | null;
} | null | undefined;

/** Active WhatsApp transport. Default `meta`. Switch with WHATSAPP_PROVIDER=twilio. */
export function getWhatsappProvider(): WhatsappProvider {
  const raw = String(process.env.WHATSAPP_PROVIDER || 'meta').trim().toLowerCase();
  return raw === 'twilio' ? 'twilio' : 'meta';
}

function normalizeWhatsappFrom(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^whatsapp:/i.test(raw)) return raw;
  const digits = raw.replace(/\D/g, '');
  return digits ? `whatsapp:+${digits}` : raw;
}

export function resolvePlatformMetaWhatsapp(): MetaWhatsappConfig | null {
  const phoneNumberId = String(process.env.META_WHATSAPP_PHONE_NUMBER_ID || '').trim();
  const accessToken = String(process.env.META_WHATSAPP_ACCESS_TOKEN || '').trim();
  const utilityTemplate = String(process.env.META_WHATSAPP_TEMPLATE_UTILITY || '').trim();
  const marketingTemplate = String(process.env.META_WHATSAPP_TEMPLATE_MARKETING || '').trim();
  const displayPhone = String(process.env.META_WHATSAPP_DISPLAY_PHONE || '').trim();
  if (!phoneNumberId || !accessToken) return null;
  return {
    provider: 'meta',
    phoneNumberId,
    accessToken,
    ...(utilityTemplate ? { utilityTemplate } : {}),
    ...(marketingTemplate ? { marketingTemplate } : {}),
    ...(displayPhone ? { displayPhone } : {}),
  };
}

export function resolvePlatformTwilioWhatsapp(): TwilioWhatsappConfig | null {
  const accountSid = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
  const from = normalizeWhatsappFrom(
    process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_WHATSAPP_DISPLAY_PHONE || ''
  );
  const utilityContentSid = String(process.env.TWILIO_WHATSAPP_CONTENT_SID_UTILITY || '').trim();
  const marketingContentSid = String(process.env.TWILIO_WHATSAPP_CONTENT_SID_MARKETING || '').trim();
  const displayPhone = String(
    process.env.TWILIO_WHATSAPP_DISPLAY_PHONE || process.env.TWILIO_WHATSAPP_FROM || ''
  ).trim();
  if (!accountSid || !authToken || !from) return null;
  return {
    provider: 'twilio',
    accountSid,
    authToken,
    from,
    ...(utilityContentSid ? { utilityContentSid } : {}),
    ...(marketingContentSid ? { marketingContentSid } : {}),
    ...(displayPhone ? { displayPhone } : {}),
  };
}

/**
 * Shared-platform WhatsApp for the active provider only.
 * Salons never paste Phone Number ID / tokens / Twilio creds.
 */
export function resolvePlatformWhatsapp(): WhatsappPlatformConfig | null {
  return getWhatsappProvider() === 'twilio'
    ? resolvePlatformTwilioWhatsapp()
    : resolvePlatformMetaWhatsapp();
}

/** @deprecated Use resolvePlatformWhatsapp — kept for older call sites. */
export function resolveMetaWhatsapp(_business?: DeliveryBusiness): WhatsappPlatformConfig | null {
  return resolvePlatformWhatsapp();
}

function envSmtpPass(): string {
  return String(process.env.SMTP_PASS || '').replace(/\s+/g, '').trim();
}

/** Salon-only SMTP (Settings). Does not fall back to platform env. */
export function resolveBusinessSmtp(business?: DeliveryBusiness): SmtpConfig | null {
  if (!business) return null;
  const user = String(business.smtpUser || '').trim();
  const pass = String(decryptSecret(business.smtpPassEnc) || '').replace(/\s+/g, '').trim();
  if (!user || !pass) return null;
  const port = Number(business.smtpPort || 587);
  return {
    host: String(business.smtpHost || 'smtp.gmail.com').trim() || 'smtp.gmail.com',
    port: Number.isFinite(port) && port > 0 ? port : 587,
    secure: business.smtpSecure === true,
    user,
    pass,
    fromName: String(business.smtpFromName || business.name || 'Reservly').trim() || 'Reservly',
  };
}

/** Platform env SMTP (local/dev). Prefer Resend on Render free tier (SMTP ports blocked). */
export function resolveEnvSmtp(): SmtpConfig | null {
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = envSmtpPass();
  if (!user || !pass) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  return {
    host: String(process.env.SMTP_HOST || 'smtp.gmail.com').trim() || 'smtp.gmail.com',
    port: Number.isFinite(port) && port > 0 ? port : 587,
    secure: process.env.SMTP_SECURE === 'true',
    user,
    pass,
    fromName: String(process.env.SMTP_FROM_NAME || 'Reservly').trim() || 'Reservly',
  };
}

/**
 * Legacy helper: business SMTP with env fallback.
 * Prefer resolveBusinessSmtp / resolveEnvSmtp / resolveResend in new code.
 */
export function resolveSmtp(business?: DeliveryBusiness): SmtpConfig | null {
  return resolveBusinessSmtp(business) || resolveEnvSmtp();
}

/** Resend HTTP API — works on Render free (HTTPS/443; SMTP 587 is blocked). */
export function resolveResend(): ResendConfig | null {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) return null;
  const from = String(process.env.RESEND_FROM || 'Reservly <beth.t@example.com>').trim()
    || 'Reservly <beth.t@example.com>';
  return { apiKey, from };
}

/** True when platform can send auth OTP / fallback mail (Resend preferred, else env SMTP). */
export function platformEmailConfigured(): boolean {
  return !!resolveResend() || !!resolveEnvSmtp();
}

/**
 * Credentials for a send: active platform provider only, and only if the salon opted in
 * (WhatsAppConfig CONNECTED + enabled). Tenant never supplies provider secrets.
 */
export function resolveWhatsappCredentials(
  _business?: DeliveryBusiness,
  tenantConfig?: TenantWhatsAppConfig
): WhatsappPlatformConfig | null {
  const platform = resolvePlatformWhatsapp();
  if (!platform) return null;
  if (!tenantConfig?.enabled || tenantConfig.status !== 'CONNECTED') return null;
  return platform;
}

export function smtpConfigured(business?: DeliveryBusiness): boolean {
  return !!resolveBusinessSmtp(business) || platformEmailConfigured();
}

/** True when Reservly's shared WhatsApp (active provider) is configured in env. */
export function platformWhatsappConfigured(): boolean {
  return !!resolvePlatformWhatsapp();
}

/** True when platform WhatsApp is ready (ignores tenant opt-in). */
export function metaWhatsappConfigured(
  _business?: DeliveryBusiness,
  _tenantConfig?: TenantWhatsAppConfig
): boolean {
  return platformWhatsappConfigured();
}

export function tenantWhatsappOptedIn(tenantConfig?: TenantWhatsAppConfig): boolean {
  return !!(tenantConfig?.enabled && tenantConfig.status === 'CONNECTED');
}

/** Public display number for status APIs (provider-neutral to owners). */
export function platformWhatsappDisplayPhone(): string | null {
  const platform = resolvePlatformWhatsapp();
  if (!platform) return null;
  if (platform.provider === 'meta') return platform.displayPhone || null;
  const raw = platform.displayPhone || platform.from;
  const digits = String(raw || '').replace(/^whatsapp:/i, '').replace(/\D/g, '');
  return digits ? `+${digits}` : (raw || null);
}
