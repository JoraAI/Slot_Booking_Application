export type IntakeField = {
  id?: string;
  label: string;
  fieldType: string;
  required: boolean;
  options?: string[];
  placeholder?: string | null;
  order?: number;
  visible: boolean;
};

export const DEFAULT_PHONE_FIELD: IntakeField = {
  label: 'Phone Number',
  fieldType: 'tel',
  required: true,
  options: [],
  placeholder: 'Enter your phone number',
  visible: true,
};

export const DEFAULT_EMAIL_FIELD: IntakeField = {
  label: 'Email Address',
  fieldType: 'email',
  required: false,
  options: [],
  placeholder: 'Enter your email address',
  visible: true,
};

function isContactType(fieldType: string): boolean {
  return fieldType === 'tel' || fieldType === 'email';
}

/** Phone and email always stay on the booking form. Phone is always required for WhatsApp notifications. */
export function ensurePhoneAndEmailFields<T extends IntakeField>(
  incoming: T[],
  previous: IntakeField[] = []
): T[] {
  const next = incoming.map((field) => (
    isContactType(field.fieldType) ? { ...field, visible: true } : field
  ));

  const insertAfterName = (() => {
    const nameIndex = next.findIndex((field) => /name/i.test(field.label) && field.fieldType === 'text');
    return nameIndex >= 0 ? nameIndex + 1 : Math.min(1, next.length);
  })();

  const attach = (type: 'tel' | 'email', fallback: IntakeField) => {
    if (next.some((field) => field.fieldType === type)) return;
    const fromPrevious = previous.find((field) => field.fieldType === type);
    const restored = {
      ...(fromPrevious || fallback),
      id: fromPrevious?.id || `contact-${type}`,
      fieldType: type,
      visible: true,
      ...(type === 'tel' ? { required: true } : {}),
    } as T;
    const telIndex = next.findIndex((field) => field.fieldType === 'tel');
    const at = type === 'email' && telIndex >= 0 ? telIndex + 1 : insertAfterName;
    next.splice(Math.min(at, next.length), 0, restored);
  };

  attach('tel', DEFAULT_PHONE_FIELD);
  attach('email', DEFAULT_EMAIL_FIELD);
  return next.map((field, index) => ({
    ...field,
    order: index,
    ...(isContactType(field.fieldType) ? { visible: true } : {}),
    ...(field.fieldType === 'tel' ? { required: true } : {}),
  }));
}
