/** Normalize a form-field label into a stable attribute key (e.g. "Gender" → "gender"). */
export function attributeKeyFromLabel(label: string): string {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
}

const SKIP_FIELD_TYPES = new Set(['tel', 'email', 'textarea', 'checkbox']);

/**
 * Pull targetable profile values from booking form answers.
 * Skips contact/name fields; keeps select/text/number answers like gender.
 */
export function attributesFromFormData(
  fields: Array<{ id: string; label: string; fieldType: string }>,
  formData?: Record<string, unknown> | null
): Record<string, string> {
  if (!formData || typeof formData !== 'object') return {};
  const out: Record<string, string> = {};
  for (const field of fields) {
    if (SKIP_FIELD_TYPES.has(field.fieldType)) continue;
    if (/\b(full\s*)?name\b/i.test(field.label) && field.fieldType === 'text') continue;
    const raw = formData[field.id];
    if (raw == null || typeof raw === 'boolean') continue;
    const value = String(raw).trim();
    if (!value) continue;
    const key = attributeKeyFromLabel(field.label);
    if (!key) continue;
    out[key] = value.slice(0, 120);
  }
  return out;
}

export function mergeAttributes(
  existing: unknown,
  next: Record<string, string>
): Record<string, string> {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? { ...(existing as Record<string, string>) }
    : {};
  for (const [key, value] of Object.entries(next)) {
    if (value) base[key] = value;
  }
  return base;
}

export function contactMatchesFilters(
  contact: { lastServiceName?: string | null; attributes?: unknown },
  filters?: {
    service?: string | null;
    attributes?: Record<string, string> | null;
  } | null
): boolean {
  if (!filters) return true;
  if (filters.service) {
    const wanted = filters.service.trim().toLowerCase();
    if ((contact.lastServiceName || '').trim().toLowerCase() !== wanted) return false;
  }
  const attrs = contact.attributes && typeof contact.attributes === 'object' && !Array.isArray(contact.attributes)
    ? (contact.attributes as Record<string, string>)
    : {};
  if (filters.attributes) {
    for (const [key, value] of Object.entries(filters.attributes)) {
      if (!value) continue;
      if (String(attrs[key] || '').trim().toLowerCase() !== value.trim().toLowerCase()) return false;
    }
  }
  return true;
}
