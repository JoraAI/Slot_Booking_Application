import React, { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import toast from 'react-hot-toast'

const COLORS = ['#7C3AED', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#6366F1', '#14B8A6']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const StaffPage: React.FC = () => {
  const { config } = useStore()
  const [staffList, setStaffList] = useState<any[]>([])
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [loading, setLoading] = useState(false)
  const [hoursEditor, setHoursEditor] = useState<{ id: string; name: string } | null>(null)

  // Seed the list from the owner config (fetched by DashboardLayout), then keep
  // in-session additions on top.
  useEffect(() => {
    if (config?.staff?.length) setStaffList(config.staff)
  }, [config])

  const handleAdd = async () => {
    if (!name) return
    setLoading(true)
    try {
      const s = await api.createStaff({ name, role, phone, email, color })
      setStaffList([...staffList, s])
      setShowForm(false)
      setName(''); setRole(''); setPhone(''); setEmail('')
      toast.success('Staff added')
    } catch (err: any) {
      toast.error(err.message || 'Failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Staff</h1>
        <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark">
          + Add Staff
        </button>
      </div>

      {showForm && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4 max-w-lg">
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Role</label>
            <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Senior Stylist" className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Phone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Color</label>
            <div className="flex gap-2">
              {COLORS.map(c => (
                <button key={c} onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full ${color === c ? 'ring-2 ring-offset-2 ring-primary' : ''}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={loading} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {loading ? 'Adding...' : 'Add Staff'}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm">Cancel</button>
          </div>
        </div>
      )}

      {staffList.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
          <p className="text-3xl mb-2">👥</p>
          <p className="text-gray-500">No staff members yet. Add your first staff member above.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {staffList.map((s) => (
            <div key={s.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold" style={{ backgroundColor: s.color }}>
                {s.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium">{s.name}</p>
                {s.role && <p className="text-xs text-gray-500">{s.role}</p>}
              </div>
              <button
                onClick={() => setHoursEditor({ id: s.id, name: s.name })}
                className="px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-800"
                title="Set per-day working hours for this staff member"
              >
                🕐 Hours
              </button>
            </div>
          ))}
        </div>
      )}

      {hoursEditor && <StaffHoursEditor staffId={hoursEditor.id} staffName={hoursEditor.name} onClose={() => setHoursEditor(null)} />}
    </div>
  )
}

function StaffHoursEditor({ staffId, staffName, onClose }: { staffId: string; staffName: string; onClose: () => void }) {
  const [enabled, setEnabled] = useState(false)
  const [hours, setHours] = useState<{ dayOfWeek: number; openTime: string; closeTime: string; isOpen: boolean }[]>(
    DAYS.map((_, i) => ({ dayOfWeek: i, openTime: '09:00', closeTime: '18:00', isOpen: true }))
  )
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.getStaffHours(staffId).then((rows) => {
      if (rows.length > 0) {
        setEnabled(true)
        const map = new Map(rows.map((r) => [r.dayOfWeek, r]))
        setHours(DAYS.map((_, i) => ({
          dayOfWeek: i,
          openTime: map.get(i)?.openTime || '09:00',
          closeTime: map.get(i)?.closeTime || '18:00',
          isOpen: map.get(i)?.isOpen ?? true,
        })))
      }
    }).catch(() => toast.error('Failed to load staff hours'))
  }, [staffId])

  const save = async () => {
    setSaving(true)
    try {
      await api.updateStaffHours(staffId, enabled ? hours : [])
      toast.success('Staff hours saved')
      onClose()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-xl w-full max-w-lg p-6 space-y-4 my-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Hours for {staffName}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <p className="text-sm text-gray-500">When disabled, this staff member uses the business hours. Enable to set per-day hours.</p>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="rounded border-gray-300" />
          Override business hours
        </label>
        {enabled && (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {hours.map((h) => (
              <div key={h.dayOfWeek} className="flex items-center gap-2 text-sm">
                <span className="w-24">{DAYS[h.dayOfWeek]}</span>
                <input type="time" value={h.openTime} onChange={(e) => setHours(hours.map((x) => x.dayOfWeek === h.dayOfWeek ? { ...x, openTime: e.target.value } : x))}
                  className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-sm" />
                <span>-</span>
                <input type="time" value={h.closeTime} onChange={(e) => setHours(hours.map((x) => x.dayOfWeek === h.dayOfWeek ? { ...x, closeTime: e.target.value } : x))}
                  className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-sm" />
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={h.isOpen} onChange={(e) => setHours(hours.map((x) => x.dayOfWeek === h.dayOfWeek ? { ...x, isOpen: e.target.checked } : x))} className="rounded" />
                  Open
                </label>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving} className="flex-1 py-2.5 bg-primary hover:bg-primary-dark text-white rounded-lg text-sm font-medium disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Hours'}
          </button>
        </div>
      </div>
    </div>
  )
}