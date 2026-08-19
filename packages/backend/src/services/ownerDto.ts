import {
  metaWhatsappConfigured,
  smtpConfigured,
  twilioSmsConfigured,
} from './notificationCredentials';
import { ensurePhoneAndEmailFields } from './FormContactFields';

const HIDDEN_FIELDS = [
  'ownerPassword',
  'razorpayKeySecret',
  'smtpPassEnc',
  'twilioAuthTokenEnc',
  'metaWhatsappAccessTokenEnc',
] as const;

export function toOwnerConfig(business: Record<string, any>) {
  const safe = { ...business };
  for (const field of HIDDEN_FIELDS) delete safe[field];
  return {
    ...safe,
    razorpayKeySecretConfigured: !!business.razorpayKeySecret,
    smtpPassConfigured: !!business.smtpPassEnc,
    twilioAuthTokenConfigured: !!business.twilioAuthTokenEnc,
    metaWhatsappAccessTokenConfigured: !!business.metaWhatsappAccessTokenEnc,
    smtpConfigured: smtpConfigured(business),
    metaWhatsappConfigured: metaWhatsappConfigured(business),
    twilioSmsConfigured: twilioSmsConfigured(business),
    formFields: Array.isArray(business.formFields)
      ? ensurePhoneAndEmailFields(business.formFields)
      : business.formFields,
  };
}
