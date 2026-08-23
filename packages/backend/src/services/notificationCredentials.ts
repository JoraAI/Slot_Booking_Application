import { decryptSecret } from './secretCrypto';

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
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

export function resolveSmtp(business?: DeliveryBusiness): SmtpConfig | null {
  const user = String(business?.smtpUser || process.env.SMTP_USER || '').trim();
  const pass = String(decryptSecret(business?.smtpPassEnc) || process.env.SMTP_PASS || '').trim();
  if (!user || !pass) return null;
  const port = Number(business?.smtpPort || process.env.SMTP_PORT || 587);
  return {
    host: String(business?.smtpHost || process.env.SMTP_HOST || 'smtp.gmail.com').trim() || 'smtp.gmail.com',
    port: Number.isFinite(port) && port > 0 ? port : 587,
    secure: business?.smtpSecure === true || process.env.SMTP_SECURE === 'true',
    user,
    pass,
    fromName: String(business?.smtpFromName || process.env.SMTP_FROM_NAME || business?.name || 'Reservly').trim() || 'Reservly',
  };
}

export type TenantWhatsAppConfig = {
  status?: string | null;
  enabled?: boolean | null;
  connectionMode?: string | null;
} | null | undefined;

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
  return !!resolveSmtp(business);
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
