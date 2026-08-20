import {
  metaWhatsappConfigured,
  smtpConfigured,
} from './notificationCredentials';
import { ensurePhoneAndEmailFields } from './FormContactFields';

const HIDDEN_FIELDS = [
  'ownerPassword',
  'razorpayKeySecret',
  'smtpPassEnc',
  'metaWhatsappAccessTokenEnc',
] as const;

export function toOwnerConfig(business: Record<string, any>) {
  const safe = { ...business };
  for (const field of HIDDEN_FIELDS) delete safe[field];
  return {
    ...safe,
    razorpayKeySecretConfigured: !!business.razorpayKeySecret,
    smtpPassConfigured: !!business.smtpPassEnc,
    metaWhatsappAccessTokenConfigured: !!business.metaWhatsappAccessTokenEnc,
    smtpConfigured: smtpConfigured(business),
    metaWhatsappConfigured: metaWhatsappConfigured(business),
    formFields: Array.isArray(business.formFields)
      ? ensurePhoneAndEmailFields(business.formFields)
      : business.formFields,
  };
}
