import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getFieldMessage, validateCustomerForm } from './formFieldValidation'
import type { FormField } from '../types'

const field = (partial: Partial<FormField> & Pick<FormField, 'fieldType' | 'label'>): FormField => ({
  id: partial.id || 'f1',
  label: partial.label,
  fieldType: partial.fieldType,
  required: partial.required ?? false,
  options: partial.options || [],
  placeholder: partial.placeholder,
  order: partial.order ?? 0,
  visible: partial.visible ?? true,
})

test('phone warns while typing under 10 digits', () => {
  const phone = field({ label: 'Phone', fieldType: 'tel', required: true })
  const msg = getFieldMessage(phone, '98765', { requireEmpty: true, strict: false })
  assert.equal(msg?.severity, 'warning')
  assert.match(msg!.text, /5 of 10/)
})

test('phone errors when blurred with short number', () => {
  const phone = field({ label: 'Phone', fieldType: 'tel', required: true })
  const msg = getFieldMessage(phone, '98765', { requireEmpty: true, strict: true })
  assert.equal(msg?.severity, 'error')
})

test('phone warns on 11 digits without country code', () => {
  const phone = field({ label: 'Phone', fieldType: 'tel', required: true })
  const msg = getFieldMessage(phone, '98765432101', { requireEmpty: true, strict: false })
  assert.equal(msg?.severity, 'warning')
  assert.match(msg!.text, /11 digits/)
})

test('phone accepts 10 digit local numbers', () => {
  const phone = field({ label: 'Phone', fieldType: 'tel', required: true })
  assert.equal(getFieldMessage(phone, '9876543210', { requireEmpty: true }), null)
})

test('required empty shows error when requireEmpty is true', () => {
  const name = field({ label: 'Full Name', fieldType: 'text', required: true })
  const msg = getFieldMessage(name, '', { requireEmpty: true })
  assert.equal(msg?.severity, 'error')
  assert.match(msg!.text, /required/)
})

test('required empty is silent until requireEmpty', () => {
  const name = field({ label: 'Full Name', fieldType: 'text', required: true })
  assert.equal(getFieldMessage(name, '', { requireEmpty: false }), null)
})

test('email warns before @ is typed', () => {
  const email = field({ label: 'Email', fieldType: 'email' })
  const msg = getFieldMessage(email, 'hello', { requireEmpty: false, strict: false })
  assert.equal(msg?.severity, 'warning')
  assert.match(msg!.text, /@/)
})

test('validateCustomerForm blocks short and 11-digit phones', () => {
  const fields = [
    field({ id: 'phone', label: 'Phone', fieldType: 'tel', required: true }),
  ]
  const short = validateCustomerForm(fields, { phone: '98765' }, { requireEmpty: true })
  assert.equal(short.isValid, false)
  assert.ok(short.errors.phone)

  const eleven = validateCustomerForm(fields, { phone: '98765432101' }, { requireEmpty: true })
  assert.equal(eleven.isValid, false)
  assert.ok(eleven.errors.phone)

  const ok = validateCustomerForm(fields, { phone: '9876543210' }, { requireEmpty: true })
  assert.equal(ok.isValid, true)
})
