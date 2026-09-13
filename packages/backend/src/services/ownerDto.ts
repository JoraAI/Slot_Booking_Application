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
    passwordSet: !!business.ownerPassword,
    googleLinked: !!business.googleSub,
    razorpayKeySecretConfigured: !!business.razorpayKeySecret,
    smtpPassConfigured: !!business.smtpPassEnc,
    metaWhatsappAccessTokenConfigured: false,
    smtpConfigured: smtpConfigured(business),
    metaWhatsappConfigured: metaWhatsappConfigured(),
    formFields: Array.isArray(business.formFields)
      ? ensurePhoneAndEmailFields(business.formFields)
      : business.formFields,
    services: Array.isArray(business.services)
      ? business.services.map((s: any) => ({
          ...s,
          assignedStaffIds: Array.isArray(s.assignedStaffIds)
            ? s.assignedStaffIds
            : Array.isArray(s.staff)
              ? s.staff.map((x: any) => x.staffId).filter(Boolean)
              : [],
        }))
      : business.services,
  };
}
