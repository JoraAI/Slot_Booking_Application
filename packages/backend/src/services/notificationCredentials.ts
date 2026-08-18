import { decryptSecret } from './secretCrypto';

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
};

export type TwilioConfig = {
  accountSid: string;
  authToken: string;
  from: string;
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
  twilioAccountSid?: string | null;
  twilioAuthTokenEnc?: string | null;
  twilioWhatsappFrom?: string | null;
  twilioSmsFrom?: string | null;
  metaWhatsappPhoneNumberId?: string | null;
  metaWhatsappAccessTokenEnc?: string | null;
  metaWhatsappTemplateUtility?: string | null;
  metaWhatsappTemplateMarketing?: string | null;
} | null | undefined;

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

function normalizeWhatsappFrom(from: string): string {
  const trimmed = from.trim();
  return trimmed.startsWith('whatsapp:') ? trimmed : `whatsapp:${trimmed}`;
}

export function resolveTwilioWhatsapp(business?: DeliveryBusiness): TwilioConfig | null {
  const accountSid = String(business?.twilioAccountSid || process.env.TWILIO_ACCOUNT_SID || '').trim();
  const authToken = String(decryptSecret(business?.twilioAuthTokenEnc) || process.env.TWILIO_AUTH_TOKEN || '').trim();
  const from = String(business?.twilioWhatsappFrom || process.env.TWILIO_WHATSAPP_FROM || '').trim();
  if (!accountSid || !authToken || !from) return null;
  return { accountSid, authToken, from: normalizeWhatsappFrom(from) };
}

export function resolveTwilioSms(business?: DeliveryBusiness): TwilioConfig | null {
  const accountSid = String(business?.twilioAccountSid || process.env.TWILIO_ACCOUNT_SID || '').trim();
  const authToken = String(decryptSecret(business?.twilioAuthTokenEnc) || process.env.TWILIO_AUTH_TOKEN || '').trim();
  const from = String(business?.twilioSmsFrom || process.env.TWILIO_SMS_FROM || '').trim();
  if (!accountSid || !authToken || !from) return null;
  return { accountSid, authToken, from };
}

export function resolveMetaWhatsapp(business?: DeliveryBusiness): MetaWhatsappConfig | null {
  const phoneNumberId = String(
    business?.metaWhatsappPhoneNumberId || process.env.META_WHATSAPP_PHONE_NUMBER_ID || ''
  ).trim();
  const accessToken = String(
    decryptSecret(business?.metaWhatsappAccessTokenEnc) || process.env.META_WHATSAPP_ACCESS_TOKEN || ''
  ).trim();
  const utilityTemplate = String(
    business?.metaWhatsappTemplateUtility || process.env.META_WHATSAPP_TEMPLATE_UTILITY || ''
  ).trim();
  const marketingTemplate = String(
    business?.metaWhatsappTemplateMarketing || process.env.META_WHATSAPP_TEMPLATE_MARKETING || ''
  ).trim();
  if (!phoneNumberId || !accessToken) return null;
  return {
    phoneNumberId,
    accessToken,
    ...(utilityTemplate ? { utilityTemplate } : {}),
    ...(marketingTemplate ? { marketingTemplate } : {}),
  };
}

export function smtpConfigured(business?: DeliveryBusiness): boolean {
  return !!resolveSmtp(business);
}

export function twilioWhatsappConfigured(business?: DeliveryBusiness): boolean {
  return !!resolveTwilioWhatsapp(business);
}

export function twilioSmsConfigured(business?: DeliveryBusiness): boolean {
  return !!resolveTwilioSms(business);
}

export function metaWhatsappConfigured(business?: DeliveryBusiness): boolean {
  return !!resolveMetaWhatsapp(business);
}
