import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import { MediaUploadButton } from '../components/MediaUploadButton'
import { geoFailureMessage, geolocationAvailable, mapPositionError, secureContextAvailable } from '../geolocation'
import { getCurrentPositionCoords, isNativePlatform, openExternalUrl } from '../../lib/native'
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
  const [providerStatus, setProviderStatus] = useState<{
    smtpConfigured: boolean
    metaWhatsappConfigured: boolean
    frontendUrlConfigured: boolean
    locationComplete: boolean
    ownerEmailPresent: boolean
    ownerWhatsappPresent: boolean
  } | null>(null)
  const [waStatus, setWaStatus] = useState<{
    connectionMode: string
    status: string
    displayPhone: string | null
    configured: boolean
    platformReady?: boolean
    optedIn?: boolean
    wallet: { balancePaise: number; currency: string; lowBalance: boolean; estimatedMessages: number | null }
  } | null>(null)
  const [geoError, setGeoError] = useState('')
  const [geoLoading, setGeoLoading] = useState(false)
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [newPasswordForm, setNewPasswordForm] = useState({ newPassword: '', confirmPassword: '' })
  const [savingSetPassword, setSavingSetPassword] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [form, setForm] = useState({
    name: config?.name || '',
    description: config?.description || '',
    timezone: config?.timezone || 'Asia/Kolkata',
    primaryColor: config?.primaryColor || '#7C3AED',
    secondaryColor: config?.secondaryColor || '',
    accentColor: config?.accentColor || '',
    logoUrl: config?.logoUrl || '',
    coverImageUrl: config?.coverImageUrl || '',
    address: config?.address || '',
    latitude: config?.latitude ?? null,
    longitude: config?.longitude ?? null,
    slotGranularityMinutes: config?.slotGranularityMinutes || 15,
    remindersEnabled: config?.remindersEnabled ?? true,
    reminderOffsetsMinutes: config?.reminderOffsetsMinutes?.length ? config.reminderOffsetsMinutes : [1440, 120],
    bookingManagementOtpEnabled: config?.bookingManagementOtpEnabled ?? false,
    bookingManagementOtpChannel: config?.bookingManagementOtpChannel || 'EMAIL',
    allowCustomerCancel: config?.allowCustomerCancel ?? true,
    bookingWindowDays: config?.bookingWindowDays || 7,
    minBookingNoticeHours: config?.minBookingNoticeHours ?? 0,
    showAvailableCount: config?.showAvailableCount || false,
    notifyOwnerEmail: config?.notifyOwnerEmail ?? true,
    notifyOwnerWhatsapp: config?.notifyOwnerWhatsapp ?? false,
    notifyCustomerEmail: config?.notifyCustomerEmail ?? true,
    notifyCustomerWhatsapp: config?.notifyCustomerWhatsapp ?? false,
    ownerEmail: config?.ownerEmail || '',
    ownerWhatsapp: config?.ownerWhatsapp || '',
    smtpHost: config?.smtpHost || '',
    smtpPort: config?.smtpPort ?? null,
    smtpSecure: config?.smtpSecure ?? false,
    smtpUser: config?.smtpUser || '',
    smtpFromName: config?.smtpFromName || '',
    smtpPass: '',
    clearSmtpPass: false,
    enableWaitlist: config?.enableWaitlist || false,
    enableRecurring: config?.enableRecurring || false,
    enableMultiStaff: config?.enableMultiStaff || false,
    enablePayments: config?.enablePayments || false,
    paymentMode: config?.paymentMode || 'none',
    depositAmount: config?.depositAmount || null,
    depositPercentage: config?.depositPercentage || null,
    razorpayKeyId: config?.razorpayKeyId || '',
    razorpayKeySecret: '',
    clearRazorpayKeySecret: false,
    razorpayTestMode: config?.razorpayTestMode ?? true,
    refundPolicy: config?.refundPolicy || '',
  })

  // Sync form state when config loads asynchronously (e.g. from DashboardLayout fetch)
  useEffect(() => {
    if (config) {
      setForm({
        name: config.name || '',
        description: config.description || '',
        timezone: config.timezone || 'Asia/Kolkata',
        primaryColor: config.primaryColor || '#7C3AED',
        secondaryColor: config.secondaryColor || '',
        accentColor: config.accentColor || '',
        logoUrl: config.logoUrl || '',
        coverImageUrl: config.coverImageUrl || '',
        address: config.address || '',
        latitude: config.latitude ?? null,
        longitude: config.longitude ?? null,
        slotGranularityMinutes: config.slotGranularityMinutes || 15,
        remindersEnabled: config.remindersEnabled ?? true,
        reminderOffsetsMinutes: config.reminderOffsetsMinutes?.length ? config.reminderOffsetsMinutes : [1440, 120],
        bookingManagementOtpEnabled: config.bookingManagementOtpEnabled ?? false,
        bookingManagementOtpChannel: config.bookingManagementOtpChannel || 'EMAIL',
        allowCustomerCancel: config.allowCustomerCancel ?? true,
        bookingWindowDays: config.bookingWindowDays || 7,
        minBookingNoticeHours: config.minBookingNoticeHours ?? 0,
        showAvailableCount: config.showAvailableCount || false,
        notifyOwnerEmail: config.notifyOwnerEmail ?? true,
        notifyOwnerWhatsapp: config.notifyOwnerWhatsapp ?? false,
        notifyCustomerEmail: config.notifyCustomerEmail ?? true,
        notifyCustomerWhatsapp: config.notifyCustomerWhatsapp ?? false,
        ownerEmail: config.ownerEmail || '',
        ownerWhatsapp: config.ownerWhatsapp || '',
        smtpHost: config.smtpHost || '',
        smtpPort: config.smtpPort ?? null,
        smtpSecure: config.smtpSecure ?? false,
        smtpUser: config.smtpUser || '',
        smtpFromName: config.smtpFromName || '',
        smtpPass: '',
        clearSmtpPass: false,
        enableWaitlist: config.enableWaitlist || false,
        enableRecurring: config.enableRecurring || false,
        enableMultiStaff: config.enableMultiStaff || false,
        enablePayments: config.enablePayments || false,
        paymentMode: config.paymentMode || 'none',
        depositAmount: config.depositAmount || null,
        depositPercentage: config.depositPercentage || null,
        razorpayKeyId: config.razorpayKeyId || '',
        razorpayKeySecret: '',
        clearRazorpayKeySecret: false,
        razorpayTestMode: config.razorpayTestMode ?? true,
        refundPolicy: config.refundPolicy || '',
      })
    }
  }, [config])

  // Load delivery-provider status so the OTP UI can surface config errors
  useEffect(() => {
    api.getOwnerSettingsStatus()
      .then(setProviderStatus)
      .catch(() => setProviderStatus(null))
    api.getWhatsappStatus()
      .then((s) => setWaStatus(s))
      .catch(() => setWaStatus(null))
  }, [])

  // Batch 4 — fill lat/lng from the browser when the owner is at the salon.
  // Geolocation requires a secure context (HTTPS or localhost) + permission.
  const useMyLocation = () => {
    setGeoError('')
    if (!geolocationAvailable() && !isNativePlatform()) {
      setGeoError(geoFailureMessage('unsupported'))
      return
    }
    if (!isNativePlatform() && !secureContextAvailable()) {
      setGeoError(geoFailureMessage('insecure'))
      return
    }
    setGeoLoading(true)
    void getCurrentPositionCoords()
      .then((coords) => {
        setForm(p => ({
          ...p,
          latitude: Math.round(coords.latitude * 1e6) / 1e6,
          longitude: Math.round(coords.longitude * 1e6) / 1e6,
        }))
        setGeoLoading(false)
        toast.success('Location captured from your device')
      })
      .catch((err: any) => {
        setGeoLoading(false)
        const code = typeof err?.code === 'number' ? err.code : 2
        setGeoError(geoFailureMessage(mapPositionError(code)))
      })
  }

  const clearLocation = () => {
    setForm(p => ({ ...p, address: '', latitude: null, longitude: null }))
    setGeoError('')
  }

  const mapPreviewUrl =
    form.latitude != null && form.longitude != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${form.latitude},${form.longitude}`
      : form.address.trim()
        ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(form.address.trim())}`
        : null

  const handleToggle = (key: string, value: boolean) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      // Owners only enter email + password; host/port/TLS stay as Gmail-friendly defaults.
      const payload = {
        ...form,
        smtpHost: form.smtpUser.trim() ? (form.smtpHost.trim() || 'smtp.gmail.com') : form.smtpHost,
        smtpPort: form.smtpUser.trim() ? (form.smtpPort ?? 587) : form.smtpPort,
        smtpSecure: false,
      }
      const updated = await api.updateConfig(payload)
      setConfig({ ...(config as any), ...updated })
      setForm(p => ({
        ...p,
        smtpPass: '',
        razorpayKeySecret: '',
        clearSmtpPass: false,
        clearRazorpayKeySecret: false,
      }))
      api.getOwnerSettingsStatus().then(setProviderStatus).catch(() => {})
      toast.success('Settings saved')
    } catch (err: any) {
      toast.error(err.message || 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const handleUpdatePassword = async () => {
    if (passwordForm.newPassword.length < 8) {
      toast.error('New password must be at least 8 characters')
      return
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('New password and confirmation do not match')
      return
    }
    setSavingPassword(true)
    try {
      await api.updateOwnerPassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      })
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
      toast.success('Password updated')
    } catch (err: any) {
      toast.error(err.message || 'Could not update password')
    } finally {
      setSavingPassword(false)
    }
  }

  // Google-only accounts (ownerPassword null) set a password without a current one.
  const handleSetPassword = async () => {
    if (newPasswordForm.newPassword.length < 8) {
      toast.error('New password must be at least 8 characters')
      return
    }
    if (newPasswordForm.newPassword !== newPasswordForm.confirmPassword) {
      toast.error('New password and confirmation do not match')
      return
    }
    setSavingSetPassword(true)
    try {
      await api.setOwnerPassword(newPasswordForm.newPassword)
      setNewPasswordForm({ newPassword: '', confirmPassword: '' })
      if (config) setConfig({ ...(config as any), passwordSet: true } as any)
      toast.success('Password set — you can now sign in with email + password too')
    } catch (err: any) {
      toast.error(err.message || 'Could not set password')
    } finally {
      setSavingSetPassword(false)
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

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Owner Contact</h2>
          <p className="text-sm text-gray-500">
            Owner alerts are delivered here. Customer emails use the mailbox you set below (this address is Reply-To).
            WhatsApp messages are sent from Reservly’s shared number and can include your Owner WhatsApp as the contact line.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Owner Email</label>
            <input type="email" value={form.ownerEmail} onChange={(e) => setForm(p => ({ ...p, ownerEmail: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
            <p className="text-xs text-amber-600 mt-1">Changing this also changes the dashboard login email.</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Owner WhatsApp</label>
            <input value={form.ownerWhatsapp} onChange={(e) => setForm(p => ({ ...p, ownerWhatsapp: e.target.value }))}
              placeholder="+919876543210"
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
            <p className="text-xs text-gray-400 mt-1">Use international format, including country code.</p>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Dashboard password</h2>
          <p className="text-sm text-gray-500">
            {config?.passwordSet === false
              ? 'You signed in with Google and do not have a password yet. Set one to also sign in with email + password.'
              : 'Change the password used to sign in. It is stored as a one-way hash in the database and is never shown again.'}
          </p>
        </div>
        {config?.passwordSet === false ? (
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">New password</label>
              <input type="password" value={newPasswordForm.newPassword} autoComplete="new-password"
                onChange={(e) => setNewPasswordForm((p) => ({ ...p, newPassword: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Confirm new password</label>
              <input type="password" value={newPasswordForm.confirmPassword} autoComplete="new-password"
                onChange={(e) => setNewPasswordForm((p) => ({ ...p, confirmPassword: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
            </div>
          </div>
        ) : (
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Current password</label>
              <input type="password" value={passwordForm.currentPassword} autoComplete="current-password"
                onChange={(e) => setPasswordForm((p) => ({ ...p, currentPassword: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">New password</label>
              <input type="password" value={passwordForm.newPassword} autoComplete="new-password"
                onChange={(e) => setPasswordForm((p) => ({ ...p, newPassword: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Confirm new password</label>
              <input type="password" value={passwordForm.confirmPassword} autoComplete="new-password"
                onChange={(e) => setPasswordForm((p) => ({ ...p, confirmPassword: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
            </div>
          </div>
        )}
        {config?.passwordSet === false ? (
          <button onClick={handleSetPassword} disabled={savingSetPassword}
            className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">
            {savingSetPassword ? 'Setting…' : 'Set password'}
          </button>
        ) : (
          <button onClick={handleUpdatePassword} disabled={savingPassword}
            className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">
            {savingPassword ? 'Updating…' : 'Update password'}
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Email & WhatsApp delivery</h2>
            <p className="text-sm text-gray-500">
              Connect a Gmail (or similar) mailbox to email customers. WhatsApp uses Reservly’s shared number —
              enable it below and keep wallet credits topped up. Mailbox passwords are encrypted and never shown again.
            </p>
          </div>
          <Link to="/dashboard/setup-guide#notifications" className="text-sm text-primary hover:underline shrink-0">
            Setup guide →
          </Link>
        </div>

        <div className="rounded-lg border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50 dark:bg-indigo-950/30 p-4 text-sm space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">
                WhatsApp:{' '}
                {waStatus
                  ? (waStatus.optedIn && waStatus.platformReady
                      ? `Enabled${waStatus.displayPhone ? ` · via ${waStatus.displayPhone}` : ' · Reservly shared number'}`
                      : !waStatus.platformReady
                        ? 'Unavailable (platform offline)'
                        : 'Not enabled')
                  : 'Loading…'}
              </p>
              <p className="text-gray-600 dark:text-gray-400 mt-0.5">
                Messages go out from Reservly’s WhatsApp number. You do not need your own WhatsApp Business API setup.
                Add wallet credits, enable WhatsApp, then turn on “WhatsApp customers” below.
              </p>
              {waStatus?.wallet && (
                <p className="text-gray-500 mt-1">
                  Wallet: ₹{(waStatus.wallet.balancePaise / 100).toFixed(2)}
                  {waStatus.wallet.lowBalance ? ' · low balance — top up soon' : ''}
                  {waStatus.wallet.estimatedMessages != null ? ` · ≈ ${waStatus.wallet.estimatedMessages} messages left` : ''}
                </p>
              )}
            </div>
            <Link to="/dashboard/notifications" className="text-primary hover:underline font-medium shrink-0">
              Wallet & credits →
            </Link>
          </div>

          {waStatus && !waStatus.platformReady && (
            <p className="text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2">
              Reservly WhatsApp is not configured on the server yet. Email still works. Contact support if you need WhatsApp.
            </p>
          )}

          {waStatus?.platformReady && !waStatus.optedIn && (
            <button
              type="button"
              className="inline-flex justify-center items-center px-4 py-2.5 rounded-lg bg-[#25D366] text-white text-sm font-medium"
              onClick={async () => {
                try {
                  await api.connectWhatsapp()
                  const next = await api.getWhatsappStatus()
                  setWaStatus(next)
                  toast.success('WhatsApp enabled')
                } catch (e: any) {
                  toast.error(e?.message || 'Could not enable WhatsApp')
                }
              }}
            >
              Enable WhatsApp
            </button>
          )}

          {waStatus?.optedIn && (
            <button
              type="button"
              className="text-xs text-red-600 underline"
              onClick={async () => {
                try {
                  await api.disconnectWhatsapp()
                  const next = await api.getWhatsappStatus()
                  setWaStatus(next)
                  toast.success('WhatsApp disabled')
                } catch (e: any) {
                  toast.error(e?.message || 'Could not disable')
                }
              }}
            >
              Disable WhatsApp
            </button>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Email address (From)</label>
            <input type="email" value={form.smtpUser} onChange={(e) => setForm(p => ({ ...p, smtpUser: e.target.value }))}
              placeholder="you@gmail.com" autoComplete="off"
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Email password</label>
            <input type="password" value={form.smtpPass} onChange={(e) => setForm(p => ({ ...p, smtpPass: e.target.value, clearSmtpPass: false }))}
              placeholder={config?.smtpPassConfigured ? '•••••••• (leave blank to keep)' : 'Gmail App Password'}
              autoComplete="new-password"
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
            <p className="text-xs text-gray-400 mt-1">
              {config?.smtpPassConfigured ? '✓ Password saved. ' : 'Not saved yet. '}
              For Gmail, use an{' '}
              <a className="text-primary underline" href="https://support.google.com/accounts/answer/185833" target="_blank" rel="noopener noreferrer">
                App Password
              </a>
              — not your normal login password.
              {config?.smtpPassConfigured && (
                <button type="button" className="ml-1 text-red-600 underline" onClick={() => setForm(p => ({ ...p, smtpPass: '', clearSmtpPass: true }))}>
                  Remove saved password
                </button>
              )}
            </p>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium mb-1">From name</label>
            <input value={form.smtpFromName} onChange={(e) => setForm(p => ({ ...p, smtpFromName: e.target.value }))}
              placeholder={config?.name || 'Your salon'}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
            <p className="text-xs text-gray-400 mt-1">Shown as the sender name on customer emails (e.g. your salon name).</p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3 pt-2">
          {[
            { key: 'notifyCustomerEmail', label: 'Email customers' },
            { key: 'notifyOwnerEmail', label: 'Email me on bookings' },
            { key: 'notifyCustomerWhatsapp', label: 'WhatsApp customers on new bookings' },
            { key: 'notifyOwnerWhatsapp', label: 'WhatsApp me on new bookings' },
          ].map((row) => (
            <label key={row.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={Boolean((form as any)[row.key])}
                onChange={(e) => setForm(p => ({ ...p, [row.key]: e.target.checked }))}
                className="rounded border-gray-300" />
              {row.label}
            </label>
          ))}
        </div>
        <p className="text-xs text-gray-400 pt-1">
          WhatsApp is used for new booking alerts and owner promos. Cancellations are emailed only.
        </p>
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
          <p className="text-xs text-gray-500 leading-relaxed">
            UPI payments run through <strong>your own Razorpay account</strong> — connect the Key ID/Secret
            below. Customers pay with installed UPI apps (Google Pay, PhonePe, Paytm) on mobile; money
            settles to the bank account linked in your Razorpay dashboard. Cancellations automatically
            refund what was collected back to the customer's original payment method.
          </p>
          <div>
            <label className="block text-sm font-medium mb-1">Payment Mode</label>
            <p className="text-xs text-gray-500 mb-1">Prices come from each service in Services. This only controls whether customers pay full or deposit.</p>
            <select value={form.paymentMode} onChange={(e) => setForm(p => ({ ...p, paymentMode: e.target.value as 'full' | 'deposit' | 'none' }))}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800">
              <option value="none">No Payment</option>
              <option value="full">Full Payment</option>
              <option value="deposit">Deposit</option>
            </select>
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
          <p className="text-xs text-gray-400 -mt-1">
            Choose exactly one of a fixed amount or a percentage (1–100). Saving both is rejected.
          </p>
          <div className="flex items-center justify-between p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <div>
              <p className="text-sm font-medium">Test Mode</p>
              <p className="text-xs text-gray-500">Use mock payments (no real charges). Switch off for production.</p>
              <p className="text-xs text-gray-400">Live mode requires both the Razorpay Key ID and Key Secret below, or saving is rejected.</p>
            </div>
            <button onClick={() => setForm(p => ({ ...p, razorpayTestMode: !p.razorpayTestMode }))}
              className={`relative w-12 h-6 rounded-full transition-colors ${form.razorpayTestMode ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.razorpayTestMode ? 'left-6' : 'left-0.5'}`} />
            </button>
          </div>
          {!form.razorpayTestMode && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">Razorpay Key ID</label>
                <input type="text" value={form.razorpayKeyId} onChange={(e) => setForm(p => ({ ...p, razorpayKeyId: e.target.value }))}
                  placeholder="rzp_live_xxxxxxxx"
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 font-mono" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Razorpay Key Secret</label>
                <p className="text-xs text-gray-500 mb-2">
                  {config?.razorpayKeySecretConfigured ? '✓ Configured (write-only — the value is never shown)' : 'Not configured.'}{' '}
                  Enter a new value to set or replace it. Leave blank to keep the current secret.
                </p>
                <input type="password" value={form.razorpayKeySecret || ''} onChange={(e) => setForm(p => ({ ...p, razorpayKeySecret: e.target.value }))}
                  placeholder="Only set to write a new secret"
                  autoComplete="new-password"
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 font-mono" />
                {config?.razorpayKeySecretConfigured && (
                  <label className="flex items-center gap-2 mt-2 text-xs text-red-600">
                    <input type="checkbox" checked={form.clearRazorpayKeySecret || false} onChange={(e) => setForm(p => ({ ...p, clearRazorpayKeySecret: e.target.checked }))} className="rounded border-gray-300" />
                    Clear the configured secret
                  </label>
                )}
              </div>
            </>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Refund Policy (informational)</label>
            <textarea value={form.refundPolicy} onChange={(e) => setForm(p => ({ ...p, refundPolicy: e.target.value }))}
              rows={2} placeholder="Shown to customers for information only."
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
            <p className="text-xs text-gray-400">
              Online payments are always refunded automatically in full when a customer cancels, regardless of this text.
            </p>
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
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Booking window (days)</label>
            <input type="number" min={1} max={365} value={form.bookingWindowDays} onChange={(e) => setForm(p => ({ ...p, bookingWindowDays: parseInt(e.target.value) || 7 }))}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
            <p className="text-xs text-gray-400 mt-1">How far ahead customers can book.</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Earliest booking (hours from now)</label>
            <input type="number" min={0} max={168} value={form.minBookingNoticeHours} onChange={(e) => setForm(p => ({ ...p, minBookingNoticeHours: Math.max(0, parseInt(e.target.value) || 0) }))}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
            <p className="text-xs text-gray-400 mt-1">Customers can only book slots at least this many hours ahead. 0 allows any remaining slot today.</p>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Slot Grid Granularity (minutes)</label>
          <select value={form.slotGranularityMinutes} onChange={(e) => setForm(p => ({ ...p, slotGranularityMinutes: parseInt(e.target.value) || 15 }))}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800">
            <option value={5}>5 minutes</option>
            <option value={10}>10 minutes</option>
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
          </select>
          <p className="text-xs text-gray-500 mt-1">Duration and parallel capacity are set per service in Services.</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="showCount" checked={form.showAvailableCount} onChange={(e) => setForm(p => ({ ...p, showAvailableCount: e.target.checked }))}
            className="rounded border-gray-300" />
          <label htmlFor="showCount" className="text-sm">Show available seat count to customers</label>
        </div>
      </div>

      {/* Salon Location */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
        <h2 className="text-lg font-semibold">Salon Location</h2>
        <p className="text-sm text-gray-500">
          Shown on booking confirmations and customer manage pages, with a Google Maps
          "Get directions" link (no API key). Leave all fields empty to hide directions.
        </p>
        <div>
          <label className="block text-sm font-medium mb-1">Address</label>
          <textarea value={form.address} onChange={(e) => setForm(p => ({ ...p, address: e.target.value }))}
            rows={2} maxLength={500} placeholder="e.g. 12 MG Road, Bengaluru, Karnataka 560001"
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Latitude</label>
            <input type="number" step="any" value={form.latitude ?? ''} onChange={(e) => setForm(p => ({ ...p, latitude: e.target.value === '' ? null : parseFloat(e.target.value) }))}
              placeholder="e.g. 12.9716" className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Longitude</label>
            <input type="number" step="any" value={form.longitude ?? ''} onChange={(e) => setForm(p => ({ ...p, longitude: e.target.value === '' ? null : parseFloat(e.target.value) }))}
              placeholder="e.g. 77.5946" className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={useMyLocation} disabled={geoLoading}
            className="px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark disabled:opacity-50">
            {geoLoading ? 'Locating…' : '📍 Use my current location'}
          </button>
          <button type="button" onClick={clearLocation}
            className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
            Clear
          </button>
          {mapPreviewUrl && (
            <button type="button" onClick={() => void openExternalUrl(mapPreviewUrl)}
              className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-primary hover:bg-gray-50 dark:hover:bg-gray-800">
              🗺️ Preview directions
            </button>
          )}
        </div>
        {geoError && (
          <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-2">{geoError}</p>
        )}
        <p className="text-xs text-gray-400">
          Geolocation requires a secure context (HTTPS or localhost) and your permission.
          If either latitude or longitude is set, both must be set (lat −90…90, lng −180…180).
        </p>
      </div>

      {/* Branding & Public Page */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
        <h2 className="text-lg font-semibold">Branding & Public Page</h2>
        <div>
          <label className="block text-sm font-medium mb-1">Tagline / Description</label>
          <input value={form.description} onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))}
            placeholder="A short line shown on your public page"
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Timezone</label>
          <input value={form.timezone} onChange={(e) => setForm(p => ({ ...p, timezone: e.target.value }))}
            placeholder="IANA timezone, e.g. Asia/Kolkata"
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Primary Color</label>
            <input type="color" value={form.primaryColor} onChange={(e) => setForm(p => ({ ...p, primaryColor: e.target.value }))}
              className="w-full h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 cursor-pointer" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Secondary Color</label>
            <input type="color" value={form.secondaryColor} onChange={(e) => setForm(p => ({ ...p, secondaryColor: e.target.value }))}
              className="w-full h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 cursor-pointer" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Accent Color</label>
            <input type="color" value={form.accentColor} onChange={(e) => setForm(p => ({ ...p, accentColor: e.target.value }))}
              className="w-full h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 cursor-pointer" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Logo URL</label>
            <div className="flex gap-2">
              <input value={form.logoUrl} onChange={(e) => setForm(p => ({ ...p, logoUrl: e.target.value }))} placeholder="https://..." className="flex-1 min-w-0 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
              <MediaUploadButton onUploaded={(url) => setForm(p => ({ ...p, logoUrl: url }))} label="⬆ Upload" />
            </div>
            {form.logoUrl && <img src={form.logoUrl} alt="Logo preview" className="mt-2 w-14 h-14 rounded-lg object-cover" />}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Cover image</label>
            <div className="flex gap-2">
              <input value={form.coverImageUrl} onChange={(e) => setForm(p => ({ ...p, coverImageUrl: e.target.value }))} placeholder="Upload or paste image link" className="flex-1 min-w-0 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
              <MediaUploadButton
                onUploaded={(url) => setForm(p => ({ ...p, coverImageUrl: url }))}
                label="⬆ Upload"
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">Shown at the top of your public booking page.</p>
            {form.coverImageUrl && <img src={form.coverImageUrl} alt="Cover preview" className="mt-2 w-full h-20 rounded-lg object-cover" />}
          </div>
        </div>
        <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <div>
            <p className="text-sm font-medium">Appointment Reminders</p>
            <p className="text-xs text-gray-500">Automatically remind customers before their appointment (24h / 2h by default).</p>
          </div>
          <button onClick={() => setForm(p => ({ ...p, remindersEnabled: !p.remindersEnabled }))}
            className={`relative w-12 h-6 rounded-full transition-colors ${form.remindersEnabled ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'}`}>
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.remindersEnabled ? 'left-6' : 'left-0.5'}`} />
          </button>
        </div>
        {form.remindersEnabled && (
          <div>
            <label className="block text-sm font-medium mb-1">Reminder Offsets (minutes before appointment)</label>
            <input
              value={form.reminderOffsetsMinutes.join(', ')}
              onChange={(e) => setForm(p => ({ ...p, reminderOffsetsMinutes: e.target.value.split(',').map(s => parseInt(s.trim())).filter(n => Number.isFinite(n) && n > 0) }))}
              placeholder="1440, 120"
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
            <p className="text-xs text-gray-400 mt-1">Comma-separated. Example: <code>1440, 120</code> = 1 day and 2 hours before.</p>
          </div>
        )}
      </div>

      {/* Booking Management Security */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
        <h2 className="text-lg font-semibold">Booking Management Security</h2>
        <p className="text-sm text-gray-500">Customers manage bookings with a secure link. Optionally require a one-time verification code (OTP) before they can view, reschedule, or cancel.</p>

        <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <div>
            <p className="text-sm font-medium">Require OTP for booking management</p>
            <p className="text-xs text-gray-500">Adds an email verification step before customers can manage a booking.</p>
          </div>
          <button onClick={() => setForm(p => ({ ...p, bookingManagementOtpEnabled: !p.bookingManagementOtpEnabled, bookingManagementOtpChannel: 'EMAIL' }))}
            className={`relative w-12 h-6 rounded-full transition-colors ${form.bookingManagementOtpEnabled ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'}`}>
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.bookingManagementOtpEnabled ? 'left-6' : 'left-0.5'}`} />
          </button>
        </div>

        {form.bookingManagementOtpEnabled && (
          <div className="space-y-3">
            <p className={`text-xs ${providerStatus?.smtpConfigured ? 'text-green-600' : 'text-amber-600'}`}>
              {providerStatus?.smtpConfigured
                ? '✓ Email is ready — verification codes can be sent'
                : '⚠ Add your email address and password above first'}
            </p>
            {!providerStatus?.smtpConfigured && (
              <p className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-2">
                Save your email address and password in Email & WhatsApp delivery before turning this on.
              </p>
            )}
          </div>
        )}

        <label className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg cursor-pointer">
          <input
            type="checkbox"
            checked={form.allowCustomerCancel}
            onChange={(e) => setForm(p => ({ ...p, allowCustomerCancel: e.target.checked }))}
            className="mt-0.5 rounded border-gray-300"
          />
          <span>
            <span className="text-sm font-medium block">Allow customers to cancel online</span>
            <span className="text-xs text-gray-500">When unchecked, the manage-booking link still works for viewing details and invoices, but customers cannot cancel themselves.</span>
          </span>
        </label>
      </div>

      {/* QR Code */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
        <h2 className="text-lg font-semibold">Booking Widget</h2>
        <p className="text-sm text-gray-500">Share this link or QR code with your customers for booking.</p>
        <div className="flex gap-2">
          <input readOnly value={`${window.location.origin}/b/${config?.publicCode || ''}`}
            className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-gray-50 dark:bg-gray-800" />
          <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/b/${config?.publicCode || ''}`); toast.success('Copied!') }}
            className="px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm hover:bg-gray-200">Copy</button>
        </div>
      </div>
    </div>
  )
}