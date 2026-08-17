import React, { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import type { CustomerNotification } from '../../types'

export const Notifications: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<{
    smtpConfigured: boolean
    twilioWhatsappConfigured: boolean
    frontendUrlConfigured: boolean
    ownerEmailPresent: boolean
    ownerWhatsappPresent: boolean
  } | null>(null)
  const [result, setResult] = useState<{ email: { ok: boolean; error?: string }; whatsapp: { ok: boolean; error?: string } } | null>(null)
  const [history, setHistory] = useState<CustomerNotification[]>([])

  useEffect(() => {
    Promise.all([api.getOwnerSettingsStatus(), api.getCustomerNotifications()])
      .then(([readiness, notifications]) => {
        setStatus(readiness)
        setHistory(notifications)
      })
      .catch(() => setStatus(null))
  }, [])

  const handleTest = async () => {
    setLoading(true)
    try {
      const res = await api.sendTestNotification()
      setResult(res)
      if (res.email.ok || res.whatsapp.ok) toast.success('Test sent to at least one channel')
      else toast.error('Test failed — see channel details below')
    } catch (err: any) {
      toast.error(err.message || 'Failed')
    } finally {
      setLoading(false)
    }
  }

  const Row = ({ ok, label, error }: { ok?: boolean; label: string; error?: string }) => (
    <p className={`text-xs ${ok ? 'text-green-600' : 'text-amber-600'}`}>
      {ok ? '✓' : '⚠'} {label}
      {error ? ` — ${error}` : ''}
    </p>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Notifications</h1>
        <Link to="/dashboard/setup-guide#notifications" className="text-sm text-primary hover:underline">
          Setup guide →
        </Link>
      </div>

      {/* Readiness — platform prerequisites for email/WhatsApp channels */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-2 max-w-lg">
        <h2 className="text-lg font-semibold">Channel Readiness</h2>
        <p className="text-sm text-gray-500">
          Customer email/WhatsApp notifications are sent through the platform SMTP / Twilio
          senders. Channels whose prerequisites fail cannot be enabled. For setup assistance,
          contact <a href="mailto:admin@staffingpros.tech" className="text-primary underline">admin@staffingpros.tech</a>.
        </p>
        <Row ok={status?.smtpConfigured} label="SMTP configured (customer + owner emails)" error="SMTP_USER / SMTP_PASS" />
        <Row ok={status?.ownerEmailPresent} label="Owner email present (replyTo / owner alerts)" />
        <Row ok={status?.twilioWhatsappConfigured} label="Twilio WhatsApp configured" error="TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM" />
        <Row ok={status?.ownerWhatsappPresent} label="Owner WhatsApp number set (customer contact)" />
        <Row ok={status?.frontendUrlConfigured} label="HTTPS frontend URL configured (manage link)" error="FRONTEND_PUBLIC_URL" />
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4 max-w-lg">
        <h2 className="text-lg font-semibold">Test Notification</h2>
        <p className="text-sm text-gray-500">Send a test notification to verify your email and WhatsApp settings. Failures are reported per channel.</p>
        <button onClick={handleTest} disabled={loading}
          className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark disabled:opacity-50">
          {loading ? 'Sending...' : 'Send Test Notification'}
        </button>
        {result && (
          <div className="space-y-1 text-xs">
            <p className={result.email.ok ? 'text-green-600' : 'text-amber-600'}>
              Email: {result.email.ok ? 'sent' : 'failed'}{result.email.error ? ` — ${result.email.error}` : ''}
            </p>
            <p className={result.whatsapp.ok ? 'text-green-600' : 'text-amber-600'}>
              WhatsApp: {result.whatsapp.ok ? 'sent' : 'failed'}{result.whatsapp.error ? ` — ${result.whatsapp.error}` : ''}
            </p>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
        <h2 className="text-lg font-semibold mb-4">Notification History</h2>
        {history.length === 0 ? (
          <p className="text-gray-500 text-sm">Custom customer notifications will appear here.</p>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {history.map((item) => (
              <div key={item.id} className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{item.recipientName}</p>
                  <p className="text-xs text-gray-500 truncate">{item.message}</p>
                  {item.error && <p className="text-xs text-red-500 mt-1">{item.error}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs capitalize">{item.channel}</p>
                  <p className={`text-xs ${item.status === 'SENT' ? 'text-green-600' : 'text-red-500'}`}>{item.status}</p>
                  <p className="text-[10px] text-gray-400">{new Date(item.createdAt).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}