import React, { useState } from 'react'
import { api } from '../../lib/api'
import toast from 'react-hot-toast'

type FieldType = 'text' | 'number' | 'select' | 'checkbox' | 'tel' | 'email' | 'textarea'

interface FormField {
  id: string; label: string; type: FieldType; required: boolean; options?: string[]; placeholder?: string; order: number; visible: boolean
}

const DEFAULT_FIELDS: FormField[] = [
  { id: 'name', label: 'Full Name', type: 'text', required: true, order: 0, visible: true },
  { id: 'age', label: 'Age', type: 'number', required: false, order: 1, visible: true },
  { id: 'gender', label: 'Gender', type: 'select', required: false, options: ['Male', 'Female', 'Other', 'Prefer not to say'], order: 2, visible: true },
  { id: 'phone', label: 'Phone Number', type: 'tel', required: true, order: 3, visible: true },
  { id: 'email', label: 'Email Address', type: 'email', required: false, order: 4, visible: true },
  { id: 'notes', label: 'Notes / Special Requests', type: 'textarea', required: false, order: 5, visible: true },
]

export const FormBuilder: React.FC = () => {
  const [fields, setFields] = useState<FormField[]>(DEFAULT_FIELDS)
  const [showAdd, setShowAdd] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newType, setNewType] = useState<FieldType>('text')

  const toggleVisible = (id: string) => {
    setFields(prev => prev.map(f => f.id === id ? { ...f, visible: !f.visible } : f))
  }

  const toggleRequired = (id: string) => {
    setFields(prev => prev.map(f => f.id === id ? { ...f, required: !f.required } : f))
  }

  const removeField = (id: string) => {
    setFields(prev => prev.filter(f => f.id !== id))
  }

  const addField = () => {
    if (!newLabel.trim()) return
    const f: FormField = { id: Date.now().toString(), label: newLabel, type: newType, required: false, order: fields.length, visible: true }
    setFields(prev => [...prev, f])
    setNewLabel(''); setShowAdd(false)
  }

  const handleSave = async () => {
    try {
      await api.updateFormFields(fields as any)
      toast.success('Form fields saved')
    } catch (err: any) {
      toast.error(err.message || 'Failed to save')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Form Builder</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowAdd(true)} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium">+ Add Field</button>
          <button onClick={handleSave} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium">Save</button>
        </div>
      </div>

      {showAdd && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 flex gap-3 items-end max-w-lg">
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1">Label</label>
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Type</label>
            <select value={newType} onChange={(e) => setNewType(e.target.value as FieldType)} className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800">
              <option value="text">Text</option><option value="number">Number</option><option value="select">Select</option>
              <option value="checkbox">Checkbox</option><option value="tel">Phone</option><option value="email">Email</option><option value="textarea">Textarea</option>
            </select>
          </div>
          <button onClick={addField} className="px-3 py-2 bg-primary text-white rounded-lg text-sm">Add</button>
        </div>
      )}

      <div className="space-y-2">
        {fields.sort((a, b) => a.order - b.order).map((field) => (
          <div key={field.id} className={`bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 flex items-center justify-between ${!field.visible ? 'opacity-50' : ''}`}>
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">{field.type}</span>
              <span className="font-medium text-sm">{field.label}</span>
              {field.required && <span className="text-xs text-red-500">*</span>}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => toggleRequired(field.id)} className={`text-xs px-2 py-1 rounded ${field.required ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                {field.required ? 'Required' : 'Optional'}
              </button>
              <button onClick={() => toggleVisible(field.id)} className={`text-xs px-2 py-1 rounded ${field.visible ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {field.visible ? 'Visible' : 'Hidden'}
              </button>
              <button onClick={() => removeField(field.id)} className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200">Remove</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}