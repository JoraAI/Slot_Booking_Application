import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import type { CustomerContact, CustomerNotification } from '../../types'
import { RichMessageEditor } from '../components/RichMessageEditor'

export const Notifications: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<{
    smtpConfigured: boolean
    metaWhatsappConfigured: boolean
    frontendUrlConfigured: boolean
    ownerEmailPresent: boolean
    ownerWhatsappPresent: boolean
  } | null>(null)
  const [result, setResult] = useState<{ email: { ok: boolean; error?: string }; whatsapp: { ok: boolean; error?: string } } | null>(null)
  const [history, setHistory] = useState<CustomerNotification[]>([])
  const [customers, setCustomers] = useState<CustomerContact[]>([])
  const [customerId, setCustomerId] = useState('')
  const [toName, setToName] = useState('')
  const [toEmail, setToEmail] = useState('')
  const [toPhone, setToPhone] = useState('')
  const [channels, setChannels] = useState<('email' | 'whatsapp')[]>([])
  const [subject, setSubject] = useState('Message from your salon')
  const [message, setMessage] = useState('')
  const [messageHtml, setMessageHtml] = useState('')
  const [sending, setSending] = useState(false)
  const [broadcasting, setBroadcasting] = useState(false)
  const [filterOptions, setFilterOptions] = useState<{
    services: string[]
    attributes: Array<{ key: string; label: string; values: string[] }>
    totalCustomers: number
  } | null>(null)
  const [filterService, setFilterService] = useState('')
  const [filterAttrs, setFilterAttrs] = useState<Record<string, string>>({})
  const [audience, setAudience] = useState<{ matched: number; total: number } | null>(null)
  const [broadcastReport, setBroadcastReport] = useState<{
    total: number
    matched?: number
    emailed: number
    whatsapped: number
    reached: number
    unsent: Array<{ id: string; name: string; email: string | null; phone: string | null; reason: string }>
    ownerNotified: boolean
  } | null>(null)

  useEffect(() => {
    Promise.all([
      api.getOwnerSettingsStatus(),
      api.getCustomerNotifications(),
      api.getCustomers({ limit: '200' }),
      api.getCustomerFilters(),
    ])
      .then(([readiness, notifications, phonebook, filters]) => {
        setStatus(readiness)
        setHistory(notifications)
        setCustomers(phonebook.customers)
        setFilterOptions(filters)
      })
      .catch(() => setStatus(null))
  }, [])

  const filterParams = useMemo(() => {
    const params: Record<string, string> = {}
    if (filterService) params.service = filterService
    for (const [key, value] of Object.entries(filterAttrs)) {
      if (value) params[key] = value
    }
    return params
  }, [filterService, filterAttrs])

  const hasAudienceFilter = Object.keys(filterParams).length > 0

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      api.previewCustomerAudience(filterParams)
        .then((preview) => {
          if (!cancelled) setAudience({ matched: preview.matched, total: preview.total })
        })
        .catch(() => {
          if (!cancelled) setAudience(null)
        })
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [filterParams])

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

  const applyCustomer = (id: string) => {
    setCustomerId(id)
    const customer = customers.find((item) => item.id === id)
    if (!customer) return
    setToName(customer.name)
    setToEmail(customer.email || '')
    setToPhone(customer.phone || '')
    const next: ('email' | 'whatsapp')[] = []
    if (customer.email) next.push('email')
    if (customer.phone) next.push('whatsapp')
    setChannels(next)
  }

  const toggleChannel = (channel: 'email' | 'whatsapp') => {
    setChannels((current) => current.includes(channel)
      ? current.filter((item) => item !== channel)
      : [...current, channel])
  }

  const clearMessage = () => {
    setMessage('')
    setMessageHtml('')
    setSubject('Message from your salon')
  }

  const sendCustom = async () => {
    if (channels.length === 0 || !message.trim()) {
      toast.error('Choose email and/or WhatsApp and enter a message')
      return
    }
    if (channels.includes('email') && !toEmail.trim()) {
      toast.error('Enter the email address to send to')
      return
    }
    if (channels.includes('whatsapp') && !toPhone.trim()) {
      toast.error('Enter the phone number to send WhatsApp to')
      return
    }
    setSending(true)
    try {
      const res = await api.sendCustomNotification({
        customerId: customerId || null,
        name: toName.trim() || toEmail.trim() || toPhone.trim(),
        email: toEmail.trim() || null,
        phone: toPhone.trim() || null,
        channels,
        subject: subject.trim() || 'Message from your salon',
        message: message.trim(),
        messageHtml: messageHtml || message.trim(),
      })
      const sent = res.results.filter((item) => item.ok).length
      const failures = res.results.filter((item) => !item.ok)
      if (sent) toast.success(`Sent through ${sent} channel${sent === 1 ? '' : 's'}`)
      failures.forEach((item) => toast.error(`${item.channel}: ${item.error || 'failed'}`))
      if (failures.length === 0) clearMessage()
      const [notifications, phonebook] = await Promise.all([
        api.getCustomerNotifications(),
        api.getCustomers({ limit: '200' }),
      ])
      setHistory(notifications)
      setCustomers(phonebook.customers)
    } catch (err: any) {
      toast.error(err.message || 'Could not send notification')
    } finally {
      setSending(false)
    }
  }

  const sendToAudience = async () => {
    if (!message.trim()) {
      toast.error('Enter a message to send')
      return
    }
    const count = audience?.matched ?? customers.length
    if (!count) {
      toast.error(hasAudienceFilter ? 'No customers match these filters' : 'There are no customers in the phonebook yet')
      return
    }
    const label = hasAudienceFilter
      ? `Send this message to ${count} matching customer${count === 1 ? '' : 's'}?`
      : `Send this message to all ${count} customer${count === 1 ? '' : 's'}?`
    if (!window.confirm(`${label} Valid emails get email, valid WhatsApp numbers get WhatsApp.`)) {
      return
    }
    setBroadcasting(true)
    setBroadcastReport(null)
    try {
      const attrs = Object.fromEntries(Object.entries(filterAttrs).filter(([, value]) => !!value))
      const report = await api.sendBroadcastNotification({
        subject: subject.trim() || 'Message from your salon',
        message: message.trim(),
        messageHtml: messageHtml || message.trim(),
        filters: hasAudienceFilter
          ? { service: filterService || null, attributes: Object.keys(attrs).length ? attrs : null }
          : null,
      })
      setBroadcastReport(report)
      if (report.reached) toast.success(`Reached ${report.reached} of ${report.matched ?? report.total} customers`)
      if (report.unsent.length) toast.error(`${report.unsent.length} customer${report.unsent.length === 1 ? '' : 's'} were not sent`)
      const notifications = await api.getCustomerNotifications()
      setHistory(notifications)
    } catch (err: any) {
      toast.error(err.message || 'Could not send broadcast')
    } finally {
      setBroadcasting(false)
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

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-2 max-w-lg">
        <h2 className="text-lg font-semibold">Channel Readiness</h2>
        <p className="text-sm text-gray-500">
          Customer email and WhatsApp are sent from the SMTP and Meta Cloud API credentials you save in
          Settings. Channels whose credentials are missing cannot be enabled.
          Need help? Contact <a href="mailto:admin@staffingpros.tech" className="text-primary underline">admin@staffingpros.tech</a>.
        </p>
        <Row ok={status?.smtpConfigured} label="SMTP ready (emails send from your mailbox)" error="add SMTP username and password in Settings" />
        <Row ok={status?.ownerEmailPresent} label="Owner email present (alerts and Reply-To)" />
        <Row ok={status?.metaWhatsappConfigured} label="Meta WhatsApp ready (messages send from your Cloud API number)" error="add Phone Number ID and Access Token in Settings" />
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

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4 max-w-2xl">
        <h2 className="text-lg font-semibold">Send a custom message</h2>
        <p className="text-sm text-gray-500">
          Message one person, or broadcast to a filtered audience (recent service, gender, and other intake fields).
          Email keeps your formatting; WhatsApp gets the same text without fonts.
        </p>

        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3 bg-gray-50/70 dark:bg-gray-950/30">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Audience filters</h3>
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => { setFilterService(''); setFilterAttrs({}) }}
            >
              Clear filters
            </button>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Recent service</label>
              <select
                value={filterService}
                onChange={(e) => setFilterService(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800"
              >
                <option value="">Any service</option>
                {(filterOptions?.services || []).map((service) => (
                  <option key={service} value={service}>{service}</option>
                ))}
              </select>
            </div>
            {(filterOptions?.attributes || []).map((field) => (
              <div key={field.key}>
                <label className="block text-xs font-medium mb-1">{field.label}</label>
                <select
                  value={filterAttrs[field.key] || ''}
                  onChange={(e) => setFilterAttrs((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800"
                >
                  <option value="">Any</option>
                  {field.values.map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500">
            {audience
              ? `Matching ${audience.matched} of ${audience.total} customers`
              : 'Loading audience…'}
            {!filterOptions?.attributes?.length && !filterOptions?.services?.length
              ? ' — filters appear after bookings capture service / form answers like Gender.'
              : ''}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Saved customer (optional — single send)</label>
          <select value={customerId} onChange={(e) => applyCustomer(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800">
            <option value="">Type an email or number below</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}{customer.phone ? ` · ${customer.phone}` : ''}{customer.email ? ` · ${customer.email}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Name</label>
          <input value={toName} onChange={(e) => setToName(e.target.value)} placeholder="Customer name"
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Email</label>
          <input type="email" value={toEmail} onChange={(e) => {
            setToEmail(e.target.value)
            if (e.target.value.trim() && !channels.includes('email')) setChannels((c) => [...c, 'email'])
          }} placeholder="customer@example.com"
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">WhatsApp number</label>
          <input value={toPhone} onChange={(e) => {
            setToPhone(e.target.value)
            if (e.target.value.trim() && !channels.includes('whatsapp')) setChannels((c) => [...c, 'whatsapp'])
          }} placeholder="+919876543210"
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
        </div>
        <div className="flex gap-4 text-sm">
          <label className={`flex items-center gap-2 ${!toEmail.trim() ? 'opacity-40' : ''}`}>
            <input type="checkbox" checked={channels.includes('email')} disabled={!toEmail.trim()} onChange={() => toggleChannel('email')} />
            Send email
          </label>
          <label className={`flex items-center gap-2 ${!toPhone.trim() ? 'opacity-40' : ''}`}>
            <input type="checkbox" checked={channels.includes('whatsapp')} disabled={!toPhone.trim()} onChange={() => toggleChannel('whatsapp')} />
            Send WhatsApp
          </label>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Email subject</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Message</label>
          <RichMessageEditor
            valueHtml={messageHtml}
            onChange={(html, plain) => {
              setMessageHtml(html)
              setMessage(plain)
            }}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={sendCustom} disabled={sending || broadcasting}
            className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark disabled:opacity-50">
            {sending ? 'Sending...' : 'Send to this contact'}
          </button>
          <button onClick={sendToAudience} disabled={sending || broadcasting}
            className="px-4 py-2 border border-primary text-primary rounded-lg text-sm font-medium hover:bg-primary/5 disabled:opacity-50">
            {broadcasting
              ? 'Sending…'
              : hasAudienceFilter
                ? `Send to ${audience?.matched ?? 0} matching`
                : `Send to all ${audience?.total ?? customers.length} customers`}
          </button>
        </div>
        {broadcastReport && (
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2 text-sm">
            <p>
              Reached {broadcastReport.reached} of {broadcastReport.matched ?? broadcastReport.total}
              {' '}({broadcastReport.emailed} email, {broadcastReport.whatsapped} WhatsApp).
            </p>
            {broadcastReport.unsent.length === 0 ? (
              <p className="text-green-600">Everyone with a valid email or WhatsApp number was sent the message.</p>
            ) : (
              <>
                <p className="text-amber-700 dark:text-amber-300">
                  Not sent to {broadcastReport.unsent.length} customer{broadcastReport.unsent.length === 1 ? '' : 's'}
                  {broadcastReport.ownerNotified ? ' — the same list was emailed to you.' : '.'}
                </p>
                <div className="max-h-48 overflow-auto space-y-2">
                  {broadcastReport.unsent.map((person) => (
                    <div key={person.id} className="text-xs bg-amber-50 dark:bg-amber-900/20 rounded-md p-2">
                      <p className="font-medium">{person.name}</p>
                      <p className="text-gray-500">{person.email || 'No email'} · {person.phone || 'No number'}</p>
                      <p className="text-amber-800 dark:text-amber-200 mt-1">{person.reason}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
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
