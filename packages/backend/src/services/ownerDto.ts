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
  // Never expose DIY Meta credential fields as editable config (shared platform only).
  delete safe.metaWhatsappPhoneNumberId;
  delete safe.metaWhatsappBusinessAccountId;
  delete safe.metaWhatsappTemplateUtility;
  delete safe.metaWhatsappTemplateMarketing;
  return {
    ...safe,
    razorpayKeySecretConfigured: !!business.razorpayKeySecret,
    smtpPassConfigured: !!business.smtpPassEnc,
    metaWhatsappAccessTokenConfigured: false,
    smtpConfigured: smtpConfigured(business),
    metaWhatsappConfigured: metaWhatsappConfigured(),
    formFields: Array.isArray(business.formFields)
      ? ensurePhoneAndEmailFields(business.formFields)
      : business.formFields,
  };
}
