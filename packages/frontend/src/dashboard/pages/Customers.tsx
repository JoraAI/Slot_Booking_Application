import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import type { CustomerContact } from '../../types'

const EMPTY_FORM = { name: '', phone: '', email: '', notes: '' }

export const CustomersPage: React.FC = () => {
  const [customers, setCustomers] = useState<CustomerContact[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<CustomerContact | 'new' | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [notifying, setNotifying] = useState<CustomerContact | null>(null)
  const [message, setMessage] = useState('')
  const [subject, setSubject] = useState('Message from your salon')
  const [channels, setChannels] = useState<('email' | 'whatsapp')[]>([])
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api.getCustomers({ limit: '200', ...(query.trim() ? { q: query.trim() } : {}) })
      setCustomers(result.customers)
    } catch (e: any) {
      toast.error(e.message || 'Failed to load customers')
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    const timer = window.setTimeout(load, 250)
    return () => window.clearTimeout(timer)
  }, [load])

  const openEdit = (customer: CustomerContact | 'new') => {
    setEditing(customer)
    setForm(customer === 'new' ? EMPTY_FORM : {
      name: customer.name,
      phone: customer.phone || '',
      email: customer.email || '',
      notes: customer.notes || '',
    })
  }

  const saveCustomer = async () => {
    if (!form.name.trim() || (!form.phone.trim() && !form.email.trim())) {
      toast.error('Add a name and at least a phone number or email')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        notes: form.notes.trim() || null,
      }
      if (editing === 'new') await api.createCustomer(payload)
      else if (editing) await api.updateCustomer(editing.id, payload)
      toast.success(editing === 'new' ? 'Customer added' : 'Customer updated')
      setEditing(null)
      await load()
    } catch (e: any) {
      toast.error(e.message || 'Could not save customer')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (customer: CustomerContact) => {
    if (!window.confirm(`Delete ${customer.name} from the phonebook? Existing bookings are kept.`)) return
    try {
      await api.deleteCustomer(customer.id)
      toast.success('Customer deleted')
      await load()
    } catch (e: any) {
      toast.error(e.message || 'Could not delete customer')
    }
  }

  const openNotify = (customer: CustomerContact) => {
    setNotifying(customer)
    setMessage('')
    setSubject('Message from your salon')
    setChannels(customer.email ? ['email'] : customer.phone ? ['whatsapp'] : [])
  }

  const toggleChannel = (channel: 'email' | 'whatsapp') => {
    setChannels((current) => current.includes(channel)
      ? current.filter((item) => item !== channel)
      : [...current, channel])
  }

  const sendNotification = async () => {
    if (!notifying || channels.length === 0 || !message.trim()) {
      toast.error('Choose a channel and enter a message')
      return
    }
    setSaving(true)
    try {
      const result = await api.notifyCustomer(notifying.id, {
        channels,
        subject: subject.trim() || 'Message from your salon',
        message: message.trim(),
      })
      const sent = result.results.filter((item) => item.ok).length
      const failures = result.results.filter((item) => !item.ok)
      if (sent) toast.success(`Sent through ${sent} channel${sent === 1 ? '' : 's'}`)
      failures.forEach((item) => toast.error(`${item.channel}: ${item.error || 'failed'}`))
      if (failures.length === 0) setNotifying(null)
    } catch (e: any) {
      toast.error(e.message || 'Could not send notification')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Customers</h1>
          <p className="text-sm text-gray-500">
            Your phonebook updates automatically when customers book. Use Notify on a row, or send from{' '}
            <Link to="/dashboard/notifications" className="text-primary underline">Notifications</Link> with the collected email or number.
          </p>
        </div>
        <button onClick={() => openEdit('new')} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium">
          + Add Customer
        </button>
      </div>

      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, phone, or email"
          className="w-full max-w-md px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800"
        />
        <button onClick={load} className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm">Refresh</button>
      </div>

      {loading ? <div className="skeleton h-40" /> : customers.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <p className="text-3xl mb-2">📒</p>
          <p className="text-gray-500">No matching customers yet.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {customers.map((customer) => (
              <div key={customer.id} className="p-4 flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="font-medium">{customer.name}</p>
                  <p className="text-sm text-gray-500">
                    {customer.phone || 'No phone'} · {customer.email || 'No email'}
                  </p>
                  <p className="text-xs text-gray-400">
                    {customer.bookingCount} booking{customer.bookingCount === 1 ? '' : 's'}
                    {customer.lastBookedAt ? ` · Last booked ${new Date(customer.lastBookedAt).toLocaleDateString()}` : ''}
                  </p>
                  {customer.notes && <p className="text-xs text-gray-500 mt-1">{customer.notes}</p>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openNotify(customer)} className="px-3 py-1.5 text-xs bg-primary text-white rounded-lg">Notify</button>
                  <button onClick={() => openEdit(customer)} className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg">Edit</button>
                  <button onClick={() => remove(customer)} className="px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded-lg">Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {editing && (
        <Modal title={editing === 'new' ? 'Add Customer' : 'Edit Customer'} onClose={() => setEditing(null)}>
          <div className="space-y-3">
            <Field label="Name" value={form.name} onChange={(value) => setForm((f) => ({ ...f, name: value }))} />
            <Field label="Phone" value={form.phone} onChange={(value) => setForm((f) => ({ ...f, phone: value }))} placeholder="+919876543210" />
            <Field label="Email" value={form.email} onChange={(value) => setForm((f) => ({ ...f, email: value }))} placeholder="customer@example.com" type="email" />
            <div>
              <label className="block text-sm font-medium mb-1">Notes</label>
              <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={3}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
            </div>
            <button onClick={saveCustomer} disabled={saving} className="w-full py-2 bg-primary text-white rounded-lg text-sm disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Customer'}
            </button>
          </div>
        </Modal>
      )}

      {notifying && (
        <Modal title={`Notify ${notifying.name}`} onClose={() => setNotifying(null)}>
          <div className="space-y-3">
            <div className="flex gap-4 text-sm">
              <label className={`flex items-center gap-2 ${!notifying.email ? 'opacity-40' : ''}`}>
                <input type="checkbox" checked={channels.includes('email')} disabled={!notifying.email} onChange={() => toggleChannel('email')} />
                Email{notifying.email ? ` (${notifying.email})` : ' — no email saved'}
              </label>
              <label className={`flex items-center gap-2 ${!notifying.phone ? 'opacity-40' : ''}`}>
                <input type="checkbox" checked={channels.includes('whatsapp')} disabled={!notifying.phone} onChange={() => toggleChannel('whatsapp')} />
                WhatsApp{notifying.phone ? ` (${notifying.phone})` : ' — no number saved'}
              </label>
            </div>
            {channels.includes('email') && (
              <Field label="Email subject" value={subject} onChange={setSubject} />
            )}
            <div>
              <label className="block text-sm font-medium mb-1">Message</label>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} maxLength={3000}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
            </div>
            <p className="text-xs text-gray-500">
              Email is sent from your SMTP mailbox, with replies going to the owner email. WhatsApp is sent from your Twilio-approved sender and includes the owner WhatsApp number as the contact.
            </p>
            <button onClick={sendNotification} disabled={saving} className="w-full py-2 bg-primary text-white rounded-lg text-sm disabled:opacity-50">
              {saving ? 'Sending…' : 'Send Notification'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 w-full max-w-lg" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-gray-500">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
    </div>
  )
}
