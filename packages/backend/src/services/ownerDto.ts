import {
  smtpConfigured,
  twilioSmsConfigured,
  twilioWhatsappConfigured,
} from './notificationCredentials';

const HIDDEN_FIELDS = [
  'ownerPassword',
  'razorpayKeySecret',
  'smtpPassEnc',
  'twilioAuthTokenEnc',
] as const;

export function toOwnerConfig(business: Record<string, any>) {
  const safe = { ...business };
  for (const field of HIDDEN_FIELDS) delete safe[field];
  return {
    ...safe,
    razorpayKeySecretConfigured: !!business.razorpayKeySecret,
    smtpPassConfigured: !!business.smtpPassEnc,
    twilioAuthTokenConfigured: !!business.twilioAuthTokenEnc,
    smtpConfigured: smtpConfigured(business),
    twilioWhatsappConfigured: twilioWhatsappConfigured(business),
    twilioSmsConfigured: twilioSmsConfigured(business),
  };
}
