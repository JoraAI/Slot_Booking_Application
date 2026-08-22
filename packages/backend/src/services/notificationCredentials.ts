import { decryptSecret } from './secretCrypto';

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
};

export type MetaWhatsappConfig = {
  phoneNumberId: string;
  accessToken: string;
  utilityTemplate?: string;
  marketingTemplate?: string;
};

type DeliveryBusiness = {
  name?: string | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure?: boolean | null;
  smtpUser?: string | null;
  smtpPassEnc?: string | null;
  smtpFromName?: string | null;
} | null | undefined;

/**
 * Shared-platform WhatsApp only.
 * Phone Number ID + access token come from Reservly env — never from salon Settings.
 */
export function resolvePlatformWhatsapp(): MetaWhatsappConfig | null {
  const phoneNumberId = String(process.env.META_WHATSAPP_PHONE_NUMBER_ID || '').trim();
  const accessToken = String(process.env.META_WHATSAPP_ACCESS_TOKEN || '').trim();
  const utilityTemplate = String(process.env.META_WHATSAPP_TEMPLATE_UTILITY || '').trim();
  const marketingTemplate = String(process.env.META_WHATSAPP_TEMPLATE_MARKETING || '').trim();
  if (!phoneNumberId || !accessToken) return null;
  return {
    phoneNumberId,
    accessToken,
    ...(utilityTemplate ? { utilityTemplate } : {}),
    ...(marketingTemplate ? { marketingTemplate } : {}),
  };
}

/** @deprecated Use resolvePlatformWhatsapp — kept for older call sites. */
export function resolveMetaWhatsapp(_business?: DeliveryBusiness): MetaWhatsappConfig | null {
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
 * Credentials for a send: platform Meta only, and only if the salon opted in
 * (WhatsAppConfig CONNECTED + enabled). Tenant never supplies Phone Number ID/token.
 */
export function resolveWhatsappCredentials(
  _business?: DeliveryBusiness,
  tenantConfig?: TenantWhatsAppConfig
): MetaWhatsappConfig | null {
  const platform = resolvePlatformWhatsapp();
  if (!platform) return null;
  if (!tenantConfig?.enabled || tenantConfig.status !== 'CONNECTED') return null;
  return platform;
}

export function smtpConfigured(business?: DeliveryBusiness): boolean {
  return !!resolveSmtp(business);
}

/** True when Reservly's shared Meta Cloud API is configured in env. */
export function platformWhatsappConfigured(): boolean {
  return !!resolvePlatformWhatsapp();
}

/** True when platform Meta is ready (ignores tenant opt-in). */
export function metaWhatsappConfigured(
  _business?: DeliveryBusiness,
  _tenantConfig?: TenantWhatsAppConfig
): boolean {
  return platformWhatsappConfigured();
}

export function tenantWhatsappOptedIn(tenantConfig?: TenantWhatsAppConfig): boolean {
  return !!(tenantConfig?.enabled && tenantConfig.status === 'CONNECTED');
}
