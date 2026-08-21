import React, { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import type { FormField } from '../../types'
import toast from 'react-hot-toast'

type FieldType = FormField['fieldType']

/** Local draft row. `id` is only a React key; the server owns persisted ids. */
interface DraftField {
  id: string
  label: string
  fieldType: FieldType
  required: boolean
  options: string[]
  placeholder: string
  visible: boolean
}

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Select' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'tel', label: 'Phone' },
  { value: 'email', label: 'Email' },
  { value: 'textarea', label: 'Textarea' },
]

const STARTER_FIELDS: Omit<DraftField, 'id'>[] = [
  { label: 'Full Name', fieldType: 'text', required: true, options: [], placeholder: 'Enter your full name', visible: true },
  { label: 'Phone Number', fieldType: 'tel', required: true, options: [], placeholder: 'Enter your phone number', visible: true },
  { label: 'Email Address', fieldType: 'email', required: false, options: [], placeholder: 'Enter your email address', visible: true },
  { label: 'Notes / Special Requests', fieldType: 'textarea', required: false, options: [], placeholder: 'Any special requests?', visible: true },
]

let draftKey = 0
const nextKey = () => `draft-${++draftKey}`

function isPhonebookField(field: { fieldType: FieldType }): boolean {
  return field.fieldType === 'tel' || field.fieldType === 'email'
}

function withPhonebookFields(fields: DraftField[]): DraftField[] {
  const next = fields.map((field) => (
    field.fieldType === 'tel'
      ? { ...field, visible: true, required: true }
      : isPhonebookField(field)
        ? { ...field, visible: true }
        : field
  ))
  if (!next.some((field) => field.fieldType === 'tel')) {
    const nameIndex = next.findIndex((field) => /name/i.test(field.label) && field.fieldType === 'text')
    next.splice(nameIndex >= 0 ? nameIndex + 1 : Math.min(1, next.length), 0, { ...STARTER_FIELDS[1], id: nextKey() })
  }
  if (!next.some((field) => field.fieldType === 'email')) {
    const telIndex = next.findIndex((field) => field.fieldType === 'tel')
    next.splice(telIndex >= 0 ? telIndex + 1 : next.length, 0, { ...STARTER_FIELDS[2], id: nextKey() })
  }
  return next
}

function toDraft(field: FormField): DraftField {
  return {
    id: field.id,
    label: field.label,
    fieldType: field.fieldType,
    required: field.required,
    options: field.options || [],
    placeholder: field.placeholder || '',
    visible: field.visible,
  }
}

export const FormBuilder: React.FC = () => {
  const { config, setConfig } = useStore()
  const [fields, setFields] = useState<DraftField[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newType, setNewType] = useState<FieldType>('text')

  // The persisted form is the source of truth; starter fields are only a
  // template for a business that has never configured its intake form.
  useEffect(() => {
    if (!config) return
    setFields(
      withPhonebookFields(
        config.formFields.length > 0
          ? config.formFields.map(toDraft)
          : STARTER_FIELDS.map((f) => ({ ...f, id: nextKey() }))
      )
    )
  }, [config])

  const update = (id: string, patch: Partial<DraftField>) => {
    setFields((prev) => prev && prev.map((f) => {
      if (f.id !== id) return f
      if (isPhonebookField(f)) {
        return { ...f, ...patch, fieldType: f.fieldType, visible: true }
      }
      return { ...f, ...patch }
    }))
  }

  const removeField = (id: string) => {
    setFields((prev) => prev && prev.filter((f) => f.id !== id || isPhonebookField(f)))
  }

  const move = (index: number, direction: -1 | 1) => {
    setFields((prev) => {
      if (!prev) return prev
      const target = index + direction
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const addField = () => {
    const label = newLabel.trim()
    if (!label) {
      toast.error('Enter a label for the new field')
      return
    }
    if ((newType === 'tel' && (fields || []).some((f) => f.fieldType === 'tel'))
      || (newType === 'email' && (fields || []).some((f) => f.fieldType === 'email'))) {
      toast.error('Phone and email are already on the form')
      return
    }
    setFields((prev) => [
      ...(prev || []),
      { id: nextKey(), label, fieldType: newType, required: false, options: [], placeholder: '', visible: true },
    ])
    setNewLabel('')
    setNewType('text')
    setShowAdd(false)
  }

  const handleSave = async () => {
    if (!fields) return
    const missingLabel = fields.find((f) => !f.label.trim())
    if (missingLabel) {
      toast.error('Every field needs a label')
      return
    }
    const emptySelect = fields.find((f) => f.fieldType === 'select' && f.options.length === 0)
    if (emptySelect) {
      toast.error(`"${emptySelect.label}" needs at least one option`)
      return
    }

    setSaving(true)
    try {
      const result = await api.updateFormFields(
        fields.map((f, index) => ({
          label: f.label.trim(),
          fieldType: f.fieldType,
          required: f.fieldType === 'tel' ? true : f.required,
          options: f.fieldType === 'select' ? f.options : [],
          placeholder: f.placeholder.trim() || null,
          order: index,
          visible: isPhonebookField(f) ? true : f.visible,
        }))
      )
      setFields(result.formFields.map(toDraft))
      if (config) setConfig({ ...config, formFields: result.formFields })
      toast.success('Form fields saved')
    } catch (err: any) {
      toast.error(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (!fields) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Form Builder</h1>
        <div className="skeleton h-16" />
        <div className="skeleton h-16" />
        <div className="skeleton h-16" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Form Builder</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Phone is always required so confirmations and cancellations can reach WhatsApp.
            Email stays on the form for the contact book - you can make email optional, but you cannot hide or remove phone or email.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowAdd(true)} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium">+ Add Field</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {fields.every((f) => !f.visible) && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 p-3 text-sm text-amber-800 dark:text-amber-200">
          Every field is hidden. Customers still see name, phone, and email. Add or unhide other fields as needed.
        </div>
      )}

      {showAdd && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 flex gap-3 items-end max-w-lg">
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1">Label</label>
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Type</label>
            <select value={newType} onChange={(e) => setNewType(e.target.value as FieldType)} className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800">
              {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <button onClick={addField} className="px-3 py-2 bg-primary text-white rounded-lg text-sm">Add</button>
          <button onClick={() => { setShowAdd(false); setNewLabel('') }} className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm">Cancel</button>
        </div>
      )}

      <div className="space-y-2">
        {fields.map((field, index) => (
          <div key={field.id} className={`bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 space-y-3 ${!field.visible ? 'opacity-60' : ''}`}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-1 min-w-[12rem]">
                <div className="flex flex-col">
                  <button onClick={() => move(index, -1)} disabled={index === 0} className="text-xs px-1 text-gray-500 disabled:opacity-30" aria-label="Move up">▲</button>
                  <button onClick={() => move(index, 1)} disabled={index === fields.length - 1} className="text-xs px-1 text-gray-500 disabled:opacity-30" aria-label="Move down">▼</button>
                </div>
                <input
                  value={field.label}
                  onChange={(e) => update(field.id, { label: e.target.value })}
                  className="flex-1 min-w-0 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium bg-white dark:bg-gray-800"
                />
                <select
                  value={field.fieldType}
                  disabled={isPhonebookField(field)}
                  onChange={(e) => update(field.id, { fieldType: e.target.value as FieldType })}
                  className="px-2 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-xs bg-white dark:bg-gray-800 disabled:opacity-60"
                >
                  {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                {field.fieldType === 'tel' ? (
                  <span className="text-xs px-2 py-1 rounded bg-red-100 text-red-700">Required</span>
                ) : (
                  <button onClick={() => update(field.id, { required: !field.required })} className={`text-xs px-2 py-1 rounded ${field.required ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                    {field.required ? 'Required' : 'Optional'}
                  </button>
                )}
                {isPhonebookField(field) ? (
                  <span className="text-xs px-2 py-1 rounded bg-green-100 text-green-700">Always shown</span>
                ) : (
                  <>
                    <button onClick={() => update(field.id, { visible: !field.visible })} className={`text-xs px-2 py-1 rounded ${field.visible ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {field.visible ? 'Visible' : 'Hidden'}
                    </button>
                    <button onClick={() => removeField(field.id)} className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200">Remove</button>
                  </>
                )}
              </div>
            </div>

            <div className="flex gap-3 flex-wrap">
              <div className="flex-1 min-w-[12rem]">
                <label className="block text-xs text-gray-500 mb-1">Placeholder</label>
                <input
                  value={field.placeholder}
                  onChange={(e) => update(field.id, { placeholder: e.target.value })}
                  placeholder={field.fieldType === 'checkbox' ? 'Checkbox text' : 'Shown inside the empty input'}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800"
                />
              </div>
              {field.fieldType === 'select' && (
                <div className="flex-1 min-w-[12rem]">
                  <label className="block text-xs text-gray-500 mb-1">Options (comma separated)</label>
                  <input
                    value={field.options.join(', ')}
                    onChange={(e) => update(field.id, { options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) })}
                    placeholder="Male, Female, Other"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800"
                  />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {fields.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">No fields yet. Add one to start building your intake form.</p>
      )}
    </div>
  )
}
