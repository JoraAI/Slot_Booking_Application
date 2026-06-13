import React, { useMemo, useCallback } from 'react'
import type { FormField } from '../../types'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface CustomerFormProps {
  fields: FormField[]
  formData: Record<string, string | boolean | number>
  onChange: (fieldId: string, value: string | boolean | number) => void
  onValidityChange?: (isValid: boolean) => void
  showErrors?: boolean
}

export const CustomerForm: React.FC<CustomerFormProps> = ({
  fields,
  formData,
  onChange,
  onValidityChange,
  showErrors = false,
}) => {
  const visibleFields = useMemo(
    () => fields.filter((f) => f.visible).sort((a, b) => a.order - b.order),
    [fields]
  )

  const getError = useCallback(
    (field: FormField): string | null => {
      const value = formData[field.id]

      // Required check
      if (field.required) {
        if (field.fieldType === 'checkbox') {
          // checkboxes: must be checked
          if (!value) return 'This field is required'
        } else {
          // text, tel, email, number, textarea, select: must be non-empty string
          if (!value || (typeof value === 'string' && value.trim() === '')) {
            return `${field.label} is required`
          }
        }
      }

      // Email format validation — only if a value is provided
      if (field.fieldType === 'email' && value && typeof value === 'string' && value.trim() !== '') {
        if (!EMAIL_REGEX.test(value.trim())) {
          return 'Please enter a valid email address'
        }
      }

      // Phone format validation — only if a value is provided
      if (field.fieldType === 'tel' && value && typeof value === 'string' && value.trim() !== '') {
        if (value.trim().length < 7) {
          return 'Please enter a valid phone number'
        }
      }

      return null
    },
    [formData]
  )

  const isValid = useMemo(() => {
    return visibleFields.every((field) => getError(field) === null)
  }, [visibleFields, getError])

  // Notify parent of validity changes
  React.useEffect(() => {
    onValidityChange?.(isValid)
  }, [isValid, onValidityChange])

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Your Details</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">Please fill in your information</p>
      </div>

      <div className="space-y-4">
        {visibleFields.map((field) => {
          const error = getError(field)
          const showError = showErrors && error
          const inputBaseClass =
            'w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none'
          const inputClass = showError
            ? `${inputBaseClass} border-red-400 dark:border-red-500`
            : `${inputBaseClass} border-gray-200 dark:border-gray-700`

          return (
            <div key={field.id}>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {field.label}
                {field.required && <span className="text-red-500 ml-1">*</span>}
              </label>

              {field.fieldType === 'textarea' ? (
                <textarea
                  value={(formData[field.id] as string) || ''}
                  onChange={(e) => onChange(field.id, e.target.value)}
                  placeholder={field.placeholder}
                  required={field.required}
                  rows={3}
                  className={inputClass}
                />
              ) : field.fieldType === 'select' ? (
                <select
                  value={(formData[field.id] as string) || ''}
                  onChange={(e) => onChange(field.id, e.target.value)}
                  required={field.required}
                  className={inputClass}
                >
                  <option value="">Select...</option>
                  {field.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : field.fieldType === 'checkbox' ? (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={(formData[field.id] as boolean) || false}
                    onChange={(e) => onChange(field.id, e.target.checked)}
                    className="w-4 h-4 text-primary rounded border-gray-300 focus:ring-primary"
                  />
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {field.placeholder || 'Yes'}
                  </span>
                </label>
              ) : (
                <input
                  type={field.fieldType}
                  value={(formData[field.id] as string) || ''}
                  onChange={(e) => onChange(field.id, e.target.value)}
                  placeholder={field.placeholder}
                  required={field.required}
                  className={inputClass}
                />
              )}

              {showError && (
                <p className="mt-1 text-xs text-red-500">{error}</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Standalone validation helper for use in StepRouter
 */
export function validateCustomerForm(
  fields: FormField[],
  formData: Record<string, string | boolean | number>
): { isValid: boolean; errors: Record<string, string> } {
  const visibleFields = fields.filter((f) => f.visible)
  const errors: Record<string, string> = {}

  for (const field of visibleFields) {
    const value = formData[field.id]

    // Required check
    if (field.required) {
      if (field.fieldType === 'checkbox') {
        if (!value) errors[field.id] = `${field.label} is required`
      } else {
        if (!value || (typeof value === 'string' && value.trim() === '')) {
          errors[field.id] = `${field.label} is required`
        }
      }
    }

    // Email validation
    if (
      field.fieldType === 'email' &&
      value &&
      typeof value === 'string' &&
      value.trim() !== ''
    ) {
      if (!EMAIL_REGEX.test(value.trim())) {
        errors[field.id] = 'Please enter a valid email address'
      }
    }

    // Phone validation
    if (
      field.fieldType === 'tel' &&
      value &&
      typeof value === 'string' &&
      value.trim() !== ''
    ) {
      if (value.trim().length < 7) {
        errors[field.id] = 'Please enter a valid phone number'
      }
    }
  }

  return { isValid: Object.keys(errors).length === 0, errors }
}