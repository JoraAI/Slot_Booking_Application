import React, { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import toast from 'react-hot-toast'

const FEATURES = [
  { key: 'enableWaitlist', label: 'Waitlist', icon: '🕐', desc: 'Auto-notify customers when slots free up' },
  { key: 'enableRecurring', label: 'Recurring Bookings', icon: '🔄', desc: 'Let customers book repeating sessions' },
  { key: 'enableMultiStaff', label: 'Multi-Staff', icon: '👥', desc: 'Manage multiple bookable staff members' },
  { key: 'enablePayments', label: 'Payments (Razorpay)', icon: '💳', desc: 'Collect full or deposit payments online' },
]

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const Settings: React.FC = () => {
  const { config, setConfig } = useStore()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: config?.name || '',
    bookingWindowDays: config?.bookingWindowDays || 7,
    parallelSeats: config?.parallelSeats || 1,
    slotDurationMinutes: config?.slotDurationMinutes || 30,
    showAvailableCount: config?.showAvailableCount || false,
    notifyOwnerEmail: config?.notifyOwnerEmail ?? true,
    notifyOwnerWhatsapp: config?.notifyOwnerWhatsapp ?? false,
    notifyCustomerEmail: config?.notifyCustomerEmail ?? true,
    notifyCustomerWhatsapp: config?.notifyCustomerWhatsapp ?? false,
    enableWaitlist: config?.enableWaitlist || false,
    enableRecurring: config?.enableRecurring || false,
    enableMultiStaff: config?.enableMultiStaff || false,
    enablePayments: config?.enablePayments || false,
    paymentMode: config?.paymentMode || 'none',
    depositAmount: config?.depositAmount || null,
    depositPercentage: config?.depositPercentage || null,
    servicePrice: config?.servicePrice || null,
    razorpayKeyId: config?.razorpayKeyId || '',
    razorpayTestMode: config?.razorpayTestMode ?? true,
    refundPolicy: config?.refundPolicy || '',
  })

  // Sync form state when config loads asynchronously (e.g. from DashboardLayout fetch)
  useEffect(() => {
    if (config) {
      setForm({
        name: config.name || '',
        bookingWindowDays: config.bookingWindowDays || 7,
        parallelSeats: config.parallelSeats || 1,
        slotDurationMinutes: config.slotDurationMinutes || 30,
        showAvailableCount: config.showAvailableCount || false,
        notifyOwnerEmail: config.notifyOwnerEmail ?? true,
        notifyOwnerWhatsapp: config.notifyOwnerWhatsapp ?? false,
        notifyCustomerEmail: config.notifyCustomerEmail ?? true,
        notifyCustomerWhatsapp: config.notifyCustomerWhatsapp ?? false,
        enableWaitlist: config.enableWaitlist || false,
        enableRecurring: config.enableRecurring || false,
        enableMultiStaff: config.enableMultiStaff || false,
        enablePayments: config.enablePayments || false,
        paymentMode: config.paymentMode || 'none',
        depositAmount: config.depositAmount || null,
        depositPercentage: config.depositPercentage || null,
        servicePrice: config.servicePrice || null,
        razorpayKeyId: config.razorpayKeyId || '',
        razorpayTestMode: config.razorpayTestMode ?? true,
        refundPolicy: config.refundPolicy || '',
      })
    }
  }, [config])

  const handleToggle = (key: string, value: boolean) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.updateConfig(form)
      if (config) setConfig({ ...config, ...form })
      toast.success('Settings saved')
    } catch (err: any) {
      toast.error(err.message || 'Failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Settings</h1>
        <button onClick={handleSave} disabled={saving}
          className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark disabled:opacity-50">
          {saving ? 'Saving...' : 'Save All'}
        </button>
      </div>

      {/* Feature Toggles */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-lg font-semibold">Features</h2>
          <p className="text-sm text-gray-500">Toggle features on/off. Changes take effect immediately.</p>
        </div>
        <div className="divide-y divide-gray-200 dark:divide-gray-800">
          {FEATURES.map(f => (
            <div key={f.key} className="px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xl">{f.icon}</span>
                <div>
                  <p className="font-medium text-sm">{f.label}</p>
                  <p className="text-xs text-gray-500">{f.desc}</p>
                </div>
              </div>
              <button onClick={() => handleToggle(f.key, !form[f.key as keyof typeof form])}
                className={`relative w-12 h-6 rounded-full transition-colors ${(form as any)[f.key] ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'}`}>
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${(form as any)[f.key] ? 'left-6' : 'left-0.5'}`} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Payment Settings */}
      {form.enablePayments && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
          <h2 className="text-lg font-semibold">Payment Settings</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Service Price (₹)</label>
              <input type="number" value={form.servicePrice || ''} onChange={(e) => setForm(p => ({ ...p, servicePrice: parseFloat(e.target.value) || null }))}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Payment Mode</label>
              <select value={form.paymentMode} onChange={(e) => setForm(p => ({ ...p, paymentMode: e.target.value as 'full' | 'deposit' | 'none' }))}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800">
                <option value="none">No Payment</option>
                <option value="full">Full Payment</option>
                <option value="deposit">Deposit</option>
              </select>
            </div>
          </div>
          {form.paymentMode === 'deposit' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Deposit Amount (₹)</label>
                <input type="number" value={form.depositAmount || ''} onChange={(e) => setForm(p => ({ ...p, depositAmount: parseFloat(e.target.value) || null }))}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Deposit Percentage (%)</label>
                <input type="number" value={form.depositPercentage || ''} onChange={(e) => setForm(p => ({ ...p, depositPercentage: parseFloat(e.target.value) || null }))}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
              </div>
            </div>
          )}
          <div className="flex items-center justify-between p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <div>
              <p className="text-sm font-medium">Test Mode</p>
              <p className="text-xs text-gray-500">Use mock payments (no real charges). Switch off for production.</p>
            </div>
            <button onClick={() => setForm(p => ({ ...p, razorpayTestMode: !p.razorpayTestMode }))}
              className={`relative w-12 h-6 rounded-full transition-colors ${form.razorpayTestMode ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.razorpayTestMode ? 'left-6' : 'left-0.5'}`} />
            </button>
          </div>
          {!form.razorpayTestMode && (
            <div>
              <label className="block text-sm font-medium mb-1">Razorpay Key ID</label>
              <input type="text" value={form.razorpayKeyId} onChange={(e) => setForm(p => ({ ...p, razorpayKeyId: e.target.value }))}
                placeholder="rzp_live_xxxxxxxx"
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 font-mono" />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Refund Policy</label>
            <textarea value={form.refundPolicy} onChange={(e) => setForm(p => ({ ...p, refundPolicy: e.target.value }))}
              rows={2} placeholder="e.g. Full refund if cancelled 24 hours before the appointment."
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
          </div>
        </div>
      )}

      {/* Business Settings */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
        <h2 className="text-lg font-semibold">Business Configuration</h2>
        <div>
          <label className="block text-sm font-medium mb-1">Business Name</label>
          <input value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Booking Window (days)</label>
            <input type="number" value={form.bookingWindowDays} onChange={(e) => setForm(p => ({ ...p, bookingWindowDays: parseInt(e.target.value) || 7 }))}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Parallel Seats</label>
            <input type="number" value={form.parallelSeats} onChange={(e) => setForm(p => ({ ...p, parallelSeats: parseInt(e.target.value) || 1 }))}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Slot Duration (min)</label>
            <input type="number" value={form.slotDurationMinutes} onChange={(e) => setForm(p => ({ ...p, slotDurationMinutes: parseInt(e.target.value) || 30 }))}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="showCount" checked={form.showAvailableCount} onChange={(e) => setForm(p => ({ ...p, showAvailableCount: e.target.checked }))}
            className="rounded border-gray-300" />
          <label htmlFor="showCount" className="text-sm">Show available seat count to customers</label>
        </div>
      </div>

      {/* QR Code */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
        <h2 className="text-lg font-semibold">Booking Widget</h2>
        <p className="text-sm text-gray-500">Share this link or QR code with your customers for booking.</p>
        <div className="flex gap-2">
          <input readOnly value={`${window.location.origin}/b/${config?.slug || ''}`}
            className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-gray-50 dark:bg-gray-800" />
          <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/b/${config?.slug || ''}`); toast.success('Copied!') }}
            className="px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm hover:bg-gray-200">Copy</button>
        </div>
      </div>
    </div>
  )
}