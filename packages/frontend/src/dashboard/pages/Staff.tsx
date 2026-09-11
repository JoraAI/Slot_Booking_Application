import React, { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import toast from 'react-hot-toast'

const COLORS = ['#7C3AED', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#6366F1', '#14B8A6']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

type StaffForm = {
  name: string
  role: string
  phone: string
  email: string
  color: string
  salary: string
  commissionPercent: string
  isActive: boolean
}

const emptyForm = (): StaffForm => ({
  name: '',
  role: '',
  phone: '',
  email: '',
  color: COLORS[0],
  salary: '',
  commissionPercent: '',
  isActive: true,
})

export const StaffPage: React.FC = () => {
  const { config } = useStore()
  const [staffList, setStaffList] = useState<any[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<StaffForm>(emptyForm())
  const [editingSalary, setEditingSalary] = useState<{ id: string; name: string; value: string } | null>(null)
  const [editingCommission, setEditingCommission] = useState<{ id: string; name: string; value: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [hoursEditor, setHoursEditor] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    if (config?.staff?.length) setStaffList(config.staff)
  }, [config])

  const openAdd = () => {
    setEditingId(null)
    setForm(emptyForm())
    setShowForm(true)
  }

  const openEdit = (s: any) => {
    setEditingId(s.id)
    setForm({
      name: s.name || '',
      role: s.role || '',
      phone: s.phone || '',
      email: s.email || '',
      color: s.color || COLORS[0],
      salary: s.salary != null ? String(s.salary) : '',
      commissionPercent: s.commissionPercent != null ? String(s.commissionPercent) : '',
      isActive: s.isActive !== false,
    })
    setShowForm(true)
    setEditingSalary(null)
    setEditingCommission(null)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditingId(null)
    setForm(emptyForm())
  }

  const staffPayload = () => {
    const salary = form.salary.trim() === '' ? null : Number(form.salary)
    if (salary !== null && (!Number.isFinite(salary) || salary < 0)) {
      throw new Error('Enter a valid salary (₹) or leave it blank')
    }
    const commissionPercent = form.commissionPercent.trim() === '' ? null : Number(form.commissionPercent)
    if (commissionPercent !== null && (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100)) {
      throw new Error('Commission must be between 0 and 100, or leave blank')
    }
    return {
      name: form.name.trim(),
      role: form.role.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      color: form.color,
      isActive: form.isActive,
      salary,
      commissionPercent,
    }
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Name is required')
      return
    }
    setLoading(true)
    try {
      const payload = staffPayload()
      if (editingId) {
        const updated = await api.updateStaff(editingId, payload)
        setStaffList((list) => list.map((s) => (s.id === editingId ? { ...s, ...updated } : s)))
        toast.success('Staff updated')
      } else {
        const created = await api.createStaff(payload)
        setStaffList((list) => [...list, created])
        toast.success('Staff added')
      }
      closeForm()
    } catch (err: any) {
      toast.error(err.message || 'Failed to save staff')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (s: any) => {
    if (!window.confirm(`Delete "${s.name}"? Past bookings stay; this staff is removed from future selection.`)) return
    setLoading(true)
    try {
      await api.deleteStaff(s.id)
      setStaffList((list) => list.filter((row) => row.id !== s.id))
      if (editingId === s.id) closeForm()
      if (hoursEditor?.id === s.id) setHoursEditor(null)
      toast.success('Staff deleted')
    } catch (err: any) {
      toast.error(err.message || 'Could not delete staff')
    } finally {
      setLoading(false)
    }
  }

  const saveSalary = async (id: string) => {
    if (!editingSalary) return
    const next = editingSalary.value.trim() === '' ? null : Number(editingSalary.value)
    if (next !== null && (!Number.isFinite(next) || next < 0)) {
      toast.error('Enter a valid salary (₹) or clear the field')
      return
    }
    setLoading(true)
    try {
      const updated = await api.updateStaff(id, { salary: next })
      setStaffList((list) => list.map((s) => (s.id === id ? { ...s, ...updated } : s)))
      setEditingSalary(null)
      toast.success(next === null ? 'Salary cleared' : 'Salary saved')
    } catch (err: any) {
      toast.error(err.message || 'Could not save salary')
    } finally {
      setLoading(false)
    }
  }

  const saveCommission = async (id: string) => {
    if (!editingCommission) return
    const next = editingCommission.value.trim() === '' ? null : Number(editingCommission.value)
    if (next !== null && (!Number.isFinite(next) || next < 0 || next > 100)) {
      toast.error('Commission must be 0–100, or clear the field')
      return
    }
    setLoading(true)
    try {
      const updated = await api.updateStaff(id, { commissionPercent: next })
      setStaffList((list) => list.map((s) => (s.id === id ? { ...s, ...updated } : s)))
      setEditingCommission(null)
      toast.success(next === null ? 'Commission cleared' : 'Commission saved')
    } catch (err: any) {
      toast.error(err.message || 'Could not save commission')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Staff</h1>
        <button onClick={openAdd} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark">
          + Add Staff
        </button>
      </div>

      {showForm && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4 max-w-lg">
          <h2 className="text-lg font-semibold">{editingId ? 'Edit staff' : 'Add staff'}</h2>
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Role</label>
            <input value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} placeholder="Senior Stylist"
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Phone</label>
              <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} type="tel"
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} type="email"
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Salary (₹/month, optional)</label>
            <input value={form.salary} onChange={(e) => setForm((f) => ({ ...f, salary: e.target.value }))} type="number" min={0} step={100}
              placeholder="e.g. 25000 — leave blank for none"
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
            <p className="text-xs text-gray-400 mt-1">Owner-only field — never shown on the public booking page.</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Commission % (optional)</label>
            <input value={form.commissionPercent} onChange={(e) => setForm((f) => ({ ...f, commissionPercent: e.target.value }))} type="number" min={0} max={100} step={0.5}
              placeholder="e.g. 10 — leave blank for none"
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
            <p className="text-xs text-gray-400 mt-1">Used in Analytics for staff incentives on attributed collections.</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Color</label>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setForm((f) => ({ ...f, color: c }))}
                  className={`w-8 h-8 rounded-full ${form.color === c ? 'ring-2 ring-offset-2 ring-primary' : ''}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
          {editingId && (
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                className="rounded border-gray-300" />
              Active (shown on booking page)
            </label>
          )}
          <div className="flex gap-2">
            <button onClick={() => void handleSave()} disabled={loading}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {loading ? 'Saving...' : editingId ? 'Save changes' : 'Add Staff'}
            </button>
            <button onClick={closeForm} className="px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm">Cancel</button>
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
            <div key={s.id} className={`bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 space-y-3 ${s.isActive === false ? 'opacity-60' : ''}`}>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold shrink-0" style={{ backgroundColor: s.color }}>
                  {s.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{s.name}</p>
                  {s.role && <p className="text-xs text-gray-500">{s.role}</p>}
                  {s.isActive === false && <p className="text-xs text-amber-600 mt-0.5">Inactive</p>}
                  {s.salary != null && (
                    <p className="text-xs text-gray-400 mt-0.5">Salary: ₹{Number(s.salary).toLocaleString('en-IN')}/mo</p>
                  )}
                  {s.commissionPercent != null && (
                    <p className="text-xs text-gray-400 mt-0.5">Commission: {Number(s.commissionPercent)}%</p>
                  )}
                </div>
              </div>

              {editingSalary && editingSalary.id === s.id ? (
                <div className="space-y-1.5">
                  <input type="number" min={0} step={100} value={editingSalary.value} autoFocus
                    onChange={(e) => setEditingSalary((p) => (p ? { ...p, value: e.target.value } : p))}
                    placeholder="e.g. 25000 — empty clears"
                    className="w-full px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-md text-sm bg-white dark:bg-gray-800" />
                  <div className="flex gap-1.5">
                    <button onClick={() => void saveSalary(s.id)} disabled={loading}
                      className="px-2 py-1 bg-primary text-white rounded-md text-xs font-medium disabled:opacity-50">Save</button>
                    <button onClick={() => setEditingSalary({ id: s.id, name: s.name, value: '' })} disabled={loading}
                      className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-md text-xs hover:bg-gray-50 dark:hover:bg-gray-800">Clear</button>
                    <button onClick={() => setEditingSalary(null)} className="px-2 py-1 text-xs text-gray-500 hover:underline">Cancel</button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setEditingCommission(null); setEditingSalary({ id: s.id, name: s.name, value: s.salary != null ? String(s.salary) : '' }) }}
                  className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-md text-xs hover:bg-gray-50 dark:hover:bg-gray-800"
                  title="Set / edit / clear salary"
                >
                  {s.salary != null ? '✎ Edit salary' : '+ Set salary'}
                </button>
              )}

              {editingCommission && editingCommission.id === s.id ? (
                <div className="space-y-1.5">
                  <input type="number" min={0} max={100} step={0.5} value={editingCommission.value} autoFocus
                    onChange={(e) => setEditingCommission((p) => (p ? { ...p, value: e.target.value } : p))}
                    placeholder="e.g. 10 — empty clears"
                    className="w-full px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-md text-sm bg-white dark:bg-gray-800" />
                  <div className="flex gap-1.5">
                    <button onClick={() => void saveCommission(s.id)} disabled={loading}
                      className="px-2 py-1 bg-primary text-white rounded-md text-xs font-medium disabled:opacity-50">Save</button>
                    <button onClick={() => setEditingCommission({ id: s.id, name: s.name, value: '' })} disabled={loading}
                      className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-md text-xs hover:bg-gray-50 dark:hover:bg-gray-800">Clear</button>
                    <button onClick={() => setEditingCommission(null)} className="px-2 py-1 text-xs text-gray-500 hover:underline">Cancel</button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setEditingSalary(null); setEditingCommission({ id: s.id, name: s.name, value: s.commissionPercent != null ? String(s.commissionPercent) : '' }) }}
                  className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-md text-xs hover:bg-gray-50 dark:hover:bg-gray-800"
                  title="Set / edit / clear commission %"
                >
                  {s.commissionPercent != null ? '✎ Edit commission %' : '+ Set commission %'}
                </button>
              )}

              <div className="flex flex-wrap gap-1.5 pt-1 border-t border-gray-100 dark:border-gray-800">
                <button
                  onClick={() => setHoursEditor({ id: s.id, name: s.name })}
                  className="px-2.5 py-1.5 border border-gray-200 dark:border-gray-700 rounded-md text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-800"
                  title="Set per-day working hours for this staff member"
                >
                  🕐 Hours
                </button>
                <button
                  onClick={() => openEdit(s)}
                  className="px-2.5 py-1.5 text-xs font-medium text-primary rounded-md hover:bg-primary/10"
                >
                  Edit
                </button>
                <button
                  onClick={() => void handleDelete(s)}
                  disabled={loading}
                  className="px-2.5 py-1.5 text-xs text-red-600 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50"
                  aria-label={`Delete ${s.name}`}
                >
                  Delete
                </button>
              </div>
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
