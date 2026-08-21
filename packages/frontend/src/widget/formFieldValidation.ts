import type { FormField } from '../types'

export type FieldMessageSeverity = 'error' | 'warning'

export type FieldMessage = {
  severity: FieldMessageSeverity
  text: string
}

export type FieldValue = string | boolean | number

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const COMMON_TYPO_TLDS = new Set(['con', 'cmo', 'nt', 'coom', 'comm'])
const MAX_TEXT = 200
const MAX_TEXTAREA = 2000

function asTrimmedString(value: FieldValue | undefined): string {
  if (value == null || typeof value === 'boolean') return ''
  return String(value).trim()
}

function isEmpty(field: FormField, value: FieldValue | undefined): boolean {
  if (field.fieldType === 'checkbox') return !value
  if (typeof value === 'number') return Number.isNaN(value)
  return asTrimmedString(value) === ''
}

/** Digits only, keeping a leading + for international numbers. */
export function normalizePhoneInput(raw: string): { displayHint: string; digits: string; hasPlus: boolean } {
  const trimmed = raw.trim()
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')
  return { displayHint: trimmed, digits, hasPlus }
}

function validatePhone(raw: string, opts: { strict?: boolean } = {}): FieldMessage | null {
  const strict = opts.strict ?? false
  const { digits, hasPlus } = normalizePhoneInput(raw)
  if (!digits) return null

  if (/[^\d\s+\-().]/.test(raw.trim())) {
    return { severity: 'error', text: 'Use only digits, spaces, +, -, or parentheses' }
  }

  // International: + and country code (e.g. +91XXXXXXXXXX = 12 digits)
  if (hasPlus) {
    if (digits.length > 15) {
      return { severity: 'error', text: 'That number is too long (maximum 15 digits with country code)' }
    }
    if (digits.length < 8) {
      return {
        severity: strict ? 'error' : 'warning',
        text: strict
          ? 'Enter a complete international number with country code'
          : `Keep typing — international numbers usually need 8–15 digits (${digits.length} so far)`,
      }
    }
    if (digits.length >= 8 && digits.length < 10) {
      return {
        severity: 'warning',
        text: `Looks short for an international number (${digits.length} digits)`,
      }
    }
    return null
  }

  // Local / India-style mobile without +
  if (digits.length < 10) {
    return {
      severity: strict ? 'error' : 'warning',
      text: strict
        ? 'Enter a valid 10-digit mobile number'
        : `Enter a 10-digit mobile number (${digits.length} of 10)`,
    }
  }
  if (digits.length === 11) {
    return {
      severity: 'warning',
      text: 'That looks like 11 digits — Indian mobiles use 10, or add + with a country code',
    }
  }
  if (digits.length > 11) {
    return {
      severity: 'error',
      text: 'Too many digits — use 10 digits, or + and country code (up to 15 digits)',
    }
  }
  // Exactly 10 — accept
  return null
}

function validateEmail(raw: string, opts: { strict?: boolean } = {}): FieldMessage | null {
  const strict = opts.strict ?? false
  const value = raw.trim()
  if (!value) return null

  if (/\s/.test(value)) {
    return { severity: 'error', text: 'Email cannot contain spaces' }
  }
  if (!value.includes('@')) {
    return {
      severity: strict ? 'error' : 'warning',
      text: strict ? 'Enter a valid email address' : 'Include an @ in the email address',
    }
  }

  const [local, domain] = value.split('@')
  if (!local) {
    return { severity: 'error', text: 'Enter the part before @' }
  }
  if (!domain || !domain.includes('.')) {
    return {
      severity: strict ? 'error' : 'warning',
      text: strict ? 'Enter a valid email address' : 'Add a domain after @ (for example gmail.com)',
    }
  }

  if (!EMAIL_REGEX.test(value)) {
    return { severity: 'error', text: 'Enter a valid email address' }
  }

  const tld = domain.split('.').pop()?.toLowerCase() || ''
  if (COMMON_TYPO_TLDS.has(tld)) {
    return { severity: 'warning', text: `".${tld}" looks unusual — check for a typo` }
  }

  return null
}

function validateNumber(raw: string): FieldMessage | null {
  const value = raw.trim()
  if (!value) return null
  if (!/^-?\d+(\.\d+)?$/.test(value)) {
    return { severity: 'error', text: 'Enter a valid number' }
  }
  const n = Number(value)
  if (!Number.isFinite(n)) {
    return { severity: 'error', text: 'Enter a valid number' }
  }
  return null
}

function validateText(raw: string, max: number, label: string): FieldMessage | null {
  const value = raw.trim()
  if (!value) return null
  if (value.length > max) {
    return { severity: 'error', text: `${label} must be ${max} characters or fewer` }
  }
  if (value.length > max * 0.9) {
    return { severity: 'warning', text: `${value.length} / ${max} characters` }
  }
  return null
}

function validateSelect(field: FormField, raw: string): FieldMessage | null {
  if (!raw) return null
  if (field.options.length > 0 && !field.options.includes(raw)) {
    return { severity: 'error', text: 'Choose an option from the list' }
  }
  return null
}

/**
 * Type-aware message for a single field.
 * - `requireEmpty`: empty required fields show an error (after touch / submit).
 * - `strict`: incomplete values (e.g. short phone) become blocking errors.
 */
export function getFieldMessage(
  field: FormField,
  value: FieldValue | undefined,
  opts: { requireEmpty?: boolean; strict?: boolean } = {}
): FieldMessage | null {
  const requireEmpty = opts.requireEmpty ?? false
  const strict = opts.strict ?? false

  if (isEmpty(field, value)) {
    if (field.required && requireEmpty) {
      return { severity: 'error', text: `${field.label} is required` }
    }
    return null
  }

  if (field.fieldType === 'checkbox') return null

  const raw = asTrimmedString(value)

  switch (field.fieldType) {
    case 'tel':
      return validatePhone(raw, { strict })
    case 'email':
      return validateEmail(raw, { strict })
    case 'number':
      return validateNumber(raw)
    case 'select':
      return validateSelect(field, raw)
    case 'textarea':
      return validateText(raw, MAX_TEXTAREA, field.label)
    case 'text':
    default:
      return validateText(raw, MAX_TEXT, field.label)
  }
}

/** True when the field should block Continue (errors, or known-invalid phone length). */
export function fieldBlocksSubmit(
  field: FormField,
  value: FieldValue | undefined
): boolean {
  const message = getFieldMessage(field, value, { requireEmpty: true, strict: true })
  if (message?.severity === 'error') return true
  if (field.fieldType === 'tel' && !isEmpty(field, value)) {
    const { digits, hasPlus } = normalizePhoneInput(asTrimmedString(value))
    if (!hasPlus && digits.length === 11) return true
  }
  return false
}

export function validateCustomerForm(
  fields: FormField[],
  formData: Record<string, FieldValue>,
  opts: { requireEmpty?: boolean } = {}
): { isValid: boolean; errors: Record<string, string>; warnings: Record<string, string> } {
  const visibleFields = fields.filter((f) => f.visible)
  const errors: Record<string, string> = {}
  const warnings: Record<string, string> = {}
  const requireEmpty = opts.requireEmpty ?? true

  for (const field of visibleFields) {
    const live = getFieldMessage(field, formData[field.id], { requireEmpty, strict: false })
    const strict = getFieldMessage(field, formData[field.id], { requireEmpty, strict: true })
    if (strict?.severity === 'error') {
      errors[field.id] = strict.text
    } else if (field.fieldType === 'tel' && !isEmpty(field, formData[field.id])) {
      const { digits, hasPlus } = normalizePhoneInput(asTrimmedString(formData[field.id]))
      if (!hasPlus && digits.length === 11) {
        errors[field.id] = live?.text || 'Enter a valid 10-digit mobile number'
      }
    }
    if (live?.severity === 'warning' && !errors[field.id]) {
      warnings[field.id] = live.text
    }
  }

  return { isValid: Object.keys(errors).length === 0, errors, warnings }
}
