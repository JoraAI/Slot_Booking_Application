import React, { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import type { PageSection, PageSectionType } from '../../types'
import toast from 'react-hot-toast'

const SECTION_TYPES: { value: PageSectionType; label: string; icon: string }[] = [
  { value: 'HERO', label: 'Hero', icon: '🖼️' },
  { value: 'SERVICES', label: 'Services', icon: '💇' },
  { value: 'OFFERS', label: 'Offers', icon: '🏷️' },
  { value: 'BUSINESS_HOURS', label: 'Business Hours', icon: '🕐' },
  { value: 'ABOUT', label: 'About', icon: 'ℹ️' },
  { value: 'WHY_CHOOSE_US', label: 'Why Choose Us', icon: '⭐' },
  { value: 'GALLERY', label: 'Gallery', icon: '📷' },
  { value: 'TESTIMONIALS', label: 'Testimonials', icon: '💬' },
  { value: 'CONTACT', label: 'Contact', icon: '📞' },
  { value: 'CUSTOM_TEXT', label: 'Custom Text', icon: '📝' },
]

export const PageBuilder: React.FC = () => {
  const [sections, setSections] = useState<PageSection[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<PageSection | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    try {
      setSections(await api.getPageSections())
    } catch (e: any) {
      toast.error(e.message || 'Failed to load sections')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const toggleVisible = async (section: PageSection) => {
    try {
      await api.updatePageSection(section.id, { isVisible: !section.isVisible })
      load()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const remove = async (section: PageSection) => {
    if (!window.confirm(`Delete "${section.title || section.type}" section?`)) return
    try {
      await api.deletePageSection(section.id)
      toast.success('Section deleted')
      load()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const move = async (section: PageSection, dir: -1 | 1) => {
    const idx = sections.findIndex((s) => s.id === section.id)
    const target = idx + dir
    if (target < 0 || target >= sections.length) return
    const reordered = [...sections]
    ;[reordered[idx], reordered[target]] = [reordered[target], reordered[idx]]
    setSections(reordered)
    try {
      await Promise.all(
        reordered.map((s, i) => api.updatePageSection(s.id, { displayOrder: i }))
      )
    } catch (e: any) {
      toast.error(e.message)
      load()
    }
  }

  const input = 'w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800'
  const label = 'block text-sm font-medium mb-1'

  if (loading) {
    return <div className="skeleton h-64" />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Public Page</h1>
          <p className="text-sm text-gray-500 mt-1">Customize the branded page customers see when they open your link.</p>
        </div>
        <button onClick={() => setCreating(true)} className="px-4 py-2.5 bg-primary hover:bg-primary-dark text-white rounded-lg text-sm font-medium">
          + Add Section
        </button>
      </div>

      <div className="space-y-3">
        {sections.length === 0 && <p className="text-sm text-gray-400">No sections yet.</p>}
        {sections.map((section, i) => (
          <div key={section.id} className={`bg-white dark:bg-gray-900 rounded-xl border p-4 ${section.isVisible ? 'border-gray-200 dark:border-gray-800' : 'border-dashed opacity-60'}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-1">
                  <button onClick={() => move(section, -1)} disabled={i === 0} className="text-xs text-gray-400 hover:text-primary disabled:opacity-30">▲</button>
                  <button onClick={() => move(section, 1)} disabled={i === sections.length - 1} className="text-xs text-gray-400 hover:text-primary disabled:opacity-30">▼</button>
                </div>
                <div>
                  <div className="font-medium">{section.title || SECTION_TYPES.find(t => t.value === section.type)?.label || section.type}</div>
                  <div className="text-xs text-gray-400">{SECTION_TYPES.find(t => t.value === section.type)?.icon} {section.type}{section.content ? ' · ' + section.content.slice(0, 40) : ''}</div>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => toggleVisible(section)} className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-md hover:bg-gray-50">
                  {section.isVisible ? 'Hide' : 'Show'}
                </button>
                <button onClick={() => setEditing(section)} className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-md hover:bg-gray-50">Edit</button>
                <button onClick={() => remove(section)} className="px-3 py-1.5 text-xs border border-red-200 text-red-600 rounded-md hover:bg-red-50">Delete</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {creating && <SectionEditor mode="create" onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load() }} />}
      {editing && <SectionEditor mode="edit" section={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
    </div>
  )
}

function SectionEditor({ mode, section, onClose, onSaved }: {
  mode: 'create' | 'edit'
  section?: PageSection
  onClose: () => void
  onSaved: () => void
}) {
  const [type, setType] = useState<PageSectionType>(section?.type || 'CUSTOM_TEXT')
  const [title, setTitle] = useState(section?.title || '')
  const [content, setContent] = useState(section?.content || '')
  const [subtitle, setSubtitle] = useState<string>((section?.configuration?.subtitle as string) || '')
  const [saving, setSaving] = useState(false)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = { type, title: title || null, content: content || null, configuration: subtitle ? { subtitle } : {} }
      if (mode === 'edit' && section) {
        await api.updatePageSection(section.id, payload)
        toast.success('Section updated')
      } else {
        await api.createPageSection({ ...payload, displayOrder: 0, isVisible: true })
        toast.success('Section created')
      }
      onSaved()
    } catch (err: any) {
      toast.error(err.message || 'Failed to save section')
    } finally {
      setSaving(false)
    }
  }

  const input = 'w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800'
  const label = 'block text-sm font-medium mb-1'

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4">
      <form onSubmit={save} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-xl w-full max-w-lg p-6 space-y-4 my-8">
        <h2 className="text-lg font-semibold">{mode === 'edit' ? 'Edit Section' : 'Add Section'}</h2>
        <div>
          <label className={label}>Section Type</label>
          <select value={type} onChange={(e) => setType(e.target.value as PageSectionType)} className={input}>
            {SECTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Section heading" className={input} />
        </div>
        <div>
          <label className={label}>Content</label>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={4} placeholder="Text shown in this section" className={input} />
        </div>
        <div>
          <label className={label}>Subtitle</label>
          <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="Small supporting text" className={input} />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={saving} className="flex-1 py-2.5 bg-primary hover:bg-primary-dark text-white rounded-lg text-sm font-medium disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Section'}
          </button>
        </div>
      </form>
    </div>
  )
}
