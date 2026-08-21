import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormField } from '../../types'
import {
  getFieldMessage,
  validateCustomerForm,
  type FieldValue,
} from '../formFieldValidation'

interface CustomerFormProps {
  fields: FormField[]
  formData: Record<string, FieldValue>
  onChange: (fieldId: string, value: FieldValue) => void
  onValidityChange?: (isValid: boolean) => void
  /** When true (e.g. Continue pressed), show required errors on untouched fields too. */
  showErrors?: boolean
}

export { validateCustomerForm }

export const CustomerForm: React.FC<CustomerFormProps> = ({
  fields,
  formData,
  onChange,
  onValidityChange,
  showErrors = false,
}) => {
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [blurred, setBlurred] = useState<Record<string, boolean>>({})

  const visibleFields = useMemo(
    () => fields.filter((f) => f.visible).sort((a, b) => a.order - b.order),
    [fields]
  )

  const markTouched = useCallback((fieldId: string) => {
    setTouched((prev) => (prev[fieldId] ? prev : { ...prev, [fieldId]: true }))
  }, [])

  const markBlurred = useCallback((fieldId: string) => {
    setBlurred((prev) => (prev[fieldId] ? prev : { ...prev, [fieldId]: true }))
    markTouched(fieldId)
  }, [markTouched])

  const isValid = useMemo(() => {
    return validateCustomerForm(visibleFields, formData, { requireEmpty: true }).isValid
  }, [visibleFields, formData])

  useEffect(() => {
    onValidityChange?.(isValid)
  }, [isValid, onValidityChange])

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Your Details</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Fields check as you type. Required fields are marked with *
        </p>
      </div>

      <div className="space-y-4">
        {visibleFields.map((field) => {
          const value = formData[field.id]
          const isTouched = !!touched[field.id]
          const isBlurred = !!blurred[field.id]
          const showRequired = showErrors || isTouched
          const strict = showErrors || isBlurred
          const message = getFieldMessage(field, value, {
            requireEmpty: showRequired,
            strict,
          })
          const hasError = message?.severity === 'error'
          const hasWarning = message?.severity === 'warning'
          const showMessage = !!message

          const inputBaseClass =
            'w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 resize-none transition-colors'
          const inputClass =
            hasError && showMessage
              ? `${inputBaseClass} border-red-400 dark:border-red-500 focus:ring-red-400`
              : hasWarning && showMessage
                ? `${inputBaseClass} border-amber-400 dark:border-amber-500 focus:ring-amber-400`
                : `${inputBaseClass} border-gray-200 dark:border-gray-700 focus:ring-primary`

          const handleChange = (next: FieldValue) => {
            markTouched(field.id)
            onChange(field.id, next)
          }

          return (
            <div key={field.id}>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {field.label}
                {field.required && <span className="text-red-500 ml-1" aria-hidden>*</span>}
              </label>

              {field.fieldType === 'textarea' ? (
                <textarea
                  value={(value as string) || ''}
                  onChange={(e) => handleChange(e.target.value)}
                  onBlur={() => markBlurred(field.id)}
                  placeholder={field.placeholder}
                  required={field.required}
                  rows={3}
                  aria-invalid={hasError && showMessage}
                  aria-describedby={showMessage ? `${field.id}-hint` : undefined}
                  className={inputClass}
                />
              ) : field.fieldType === 'select' ? (
                <select
                  value={(value as string) || ''}
                  onChange={(e) => handleChange(e.target.value)}
                  onBlur={() => markBlurred(field.id)}
                  required={field.required}
                  aria-invalid={hasError && showMessage}
                  aria-describedby={showMessage ? `${field.id}-hint` : undefined}
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
                    checked={(value as boolean) || false}
                    onChange={(e) => handleChange(e.target.checked)}
                    onBlur={() => markBlurred(field.id)}
                    aria-invalid={hasError && showMessage}
                    aria-describedby={showMessage ? `${field.id}-hint` : undefined}
                    className="w-4 h-4 text-primary rounded border-gray-300 focus:ring-primary"
                  />
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {field.placeholder || 'Yes'}
                  </span>
                </label>
              ) : (
                <input
                  type={field.fieldType === 'tel' ? 'tel' : field.fieldType}
                  inputMode={
                    field.fieldType === 'tel'
                      ? 'tel'
                      : field.fieldType === 'number'
                        ? 'decimal'
                        : field.fieldType === 'email'
                          ? 'email'
                          : 'text'
                  }
                  autoComplete={
                    field.fieldType === 'tel'
                      ? 'tel'
                      : field.fieldType === 'email'
                        ? 'email'
                        : field.fieldType === 'text'
                          ? 'name'
                          : undefined
                  }
                  value={(value as string) || ''}
                  onChange={(e) => handleChange(e.target.value)}
                  onBlur={() => markBlurred(field.id)}
                  placeholder={field.placeholder}
                  required={field.required}
                  aria-invalid={hasError && showMessage}
                  aria-describedby={showMessage ? `${field.id}-hint` : undefined}
                  className={inputClass}
                />
              )}

              {showMessage && (
                <p
                  id={`${field.id}-hint`}
                  role={hasError ? 'alert' : 'status'}
                  className={`mt-1.5 text-xs leading-snug flex items-start gap-1.5 ${
                    hasError
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  <span
                    className={`mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                      hasError
                        ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                    }`}
                    aria-hidden
                  >
                    {hasError ? '!' : 'i'}
                  </span>
                  <span>{message.text}</span>
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
