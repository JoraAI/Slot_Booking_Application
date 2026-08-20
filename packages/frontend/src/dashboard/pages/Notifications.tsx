import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import type { CustomerContact, CustomerNotification } from '../../types'
import { RichMessageEditor } from '../components/RichMessageEditor'

type BroadcastReport = {
  total: number
  matched?: number
  emailed: number
  whatsapped: number
  reached: number
  unsent: Array<{ id: string; name: string; email: string | null; phone: string | null; reason: string }>
  ownerNotified: boolean
}

type FilterOptions = {
  services: string[]
  attributes: Array<{ key: string; label: string; values: string[] }>
  totalCustomers: number
}

type AudienceMode = 'individual' | 'filtered'

function useAudiencePreview(filterService: string, filterAttrs: Record<string, string>) {
  const [audience, setAudience] = useState<{ matched: number; total: number } | null>(null)
  const filterParams = useMemo(() => {
    const params: Record<string, string> = {}
    if (filterService) params.service = filterService
    for (const [key, value] of Object.entries(filterAttrs)) {
      if (value) params[key] = value
    }
    return params
  }, [filterService, filterAttrs])

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

  const hasFilter = Object.keys(filterParams).length > 0
  const filterPayload = hasFilter
    ? {
        service: filterService || null,
        attributes: (() => {
          const attrs = Object.fromEntries(Object.entries(filterAttrs).filter(([, value]) => !!value))
          return Object.keys(attrs).length ? attrs : null
        })(),
      }
    : null

  return { audience, hasFilter, filterPayload }
}

function AudienceFilters({
  filterOptions,
  filterService,
  setFilterService,
  filterAttrs,
  setFilterAttrs,
  audience,
}: {
  filterOptions: FilterOptions | null
  filterService: string
  setFilterService: (value: string) => void
  filterAttrs: Record<string, string>
  setFilterAttrs: React.Dispatch<React.SetStateAction<Record<string, string>>>
  audience: { matched: number; total: number } | null
}) {
  const inputCls = 'w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800'
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3 bg-gray-50/70 dark:bg-gray-950/30">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Filters</h3>
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
          <select value={filterService} onChange={(e) => setFilterService(e.target.value)} className={inputCls}>
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
              className={inputCls}
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
      </p>
    </div>
  )
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: AudienceMode
  onChange: (mode: AudienceMode) => void
}) {
  return (
    <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1 max-w-md">
      <button
        type="button"
        onClick={() => onChange('individual')}
        className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${mode === 'individual' ? 'bg-white dark:bg-gray-700 shadow-sm' : 'text-gray-500'}`}
      >
        One person
      </button>
      <button
        type="button"
        onClick={() => onChange('filtered')}
        className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${mode === 'filtered' ? 'bg-white dark:bg-gray-700 shadow-sm' : 'text-gray-500'}`}
      >
        Filtered group
      </button>
    </div>
  )
}

function BroadcastSummary({ report, channel }: { report: BroadcastReport; channel: 'email' | 'whatsapp' }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2 text-sm">
      <p>
        Reached {report.reached} of {report.matched ?? report.total}
        {' '}({channel === 'email' ? `${report.emailed} email` : `${report.whatsapped} WhatsApp`}).
      </p>
      {report.unsent.length === 0 ? (
        <p className="text-green-600">Everyone eligible on this channel was sent the message.</p>
      ) : (
        <>
          <p className="text-amber-700 dark:text-amber-300">
            Not sent to {report.unsent.length} customer{report.unsent.length === 1 ? '' : 's'}
            {report.ownerNotified ? ' — the same list was emailed to you.' : '.'}
          </p>
          <div className="max-h-48 overflow-auto space-y-2">
            {report.unsent.map((person) => (
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
  )
}

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
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null)

  const [emailMode, setEmailMode] = useState<AudienceMode>('individual')
  const [emailCustomerId, setEmailCustomerId] = useState('')
  const [emailName, setEmailName] = useState('')
  const [emailTo, setEmailTo] = useState('')
  const [emailSubject, setEmailSubject] = useState('Message from your salon')
  const [emailPlain, setEmailPlain] = useState('')
  const [emailHtml, setEmailHtml] = useState('')
  const [emailFilterService, setEmailFilterService] = useState('')
  const [emailFilterAttrs, setEmailFilterAttrs] = useState<Record<string, string>>({})
  const [sendingEmail, setSendingEmail] = useState(false)
  const [broadcastingEmail, setBroadcastingEmail] = useState(false)
  const [emailReport, setEmailReport] = useState<BroadcastReport | null>(null)
  const emailAudience = useAudiencePreview(emailFilterService, emailFilterAttrs)

  const [waMode, setWaMode] = useState<AudienceMode>('individual')
  const [waCustomerId, setWaCustomerId] = useState('')
  const [waName, setWaName] = useState('')
  const [waPhone, setWaPhone] = useState('')
  const [waMessage, setWaMessage] = useState('')
  const [waFilterService, setWaFilterService] = useState('')
  const [waFilterAttrs, setWaFilterAttrs] = useState<Record<string, string>>({})
  const [sendingWa, setSendingWa] = useState(false)
  const [broadcastingWa, setBroadcastingWa] = useState(false)
  const [waReport, setWaReport] = useState<BroadcastReport | null>(null)
  const waAudience = useAudiencePreview(waFilterService, waFilterAttrs)

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

  const refreshHistory = async () => {
    const [notifications, phonebook] = await Promise.all([
      api.getCustomerNotifications(),
      api.getCustomers({ limit: '200' }),
    ])
    setHistory(notifications)
    setCustomers(phonebook.customers)
  }

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

  const applyEmailCustomer = (id: string) => {
    setEmailCustomerId(id)
    const customer = customers.find((item) => item.id === id)
    if (!customer) return
    setEmailName(customer.name)
    setEmailTo(customer.email || '')
  }

  const applyWaCustomer = (id: string) => {
    setWaCustomerId(id)
    const customer = customers.find((item) => item.id === id)
    if (!customer) return
    setWaName(customer.name)
    setWaPhone(customer.phone || '')
  }

  const sendOneEmail = async () => {
    if (!emailPlain.trim()) {
      toast.error('Enter an email message')
      return
    }
    if (!emailTo.trim()) {
      toast.error('Enter the email address to send to')
      return
    }
    setSendingEmail(true)
    try {
      const res = await api.sendCustomNotification({
        customerId: emailCustomerId || null,
        name: emailName.trim() || emailTo.trim(),
        email: emailTo.trim(),
        phone: null,
        channels: ['email'],
        subject: emailSubject.trim() || 'Message from your salon',
        message: emailPlain.trim(),
        messageHtml: emailHtml || emailPlain.trim(),
      })
      const failure = res.results.find((item) => !item.ok)
      if (failure) toast.error(failure.error || 'Email failed')
      else {
        toast.success('Email sent')
        setEmailPlain('')
        setEmailHtml('')
        setEmailSubject('Message from your salon')
      }
      await refreshHistory()
    } catch (err: any) {
      toast.error(err.message || 'Could not send email')
    } finally {
      setSendingEmail(false)
    }
  }

  const sendBulkEmail = async () => {
    if (!emailPlain.trim()) {
      toast.error('Enter an email message')
      return
    }
    const count = emailAudience.audience?.matched ?? customers.length
    if (!count) {
      toast.error(emailAudience.hasFilter ? 'No customers match these filters' : 'There are no customers in the phonebook yet')
      return
    }
    if (!window.confirm(`Send this email to ${count} matching customer${count === 1 ? '' : 's'}? Only contacts with a valid email will be emailed.`)) {
      return
    }
    setBroadcastingEmail(true)
    setEmailReport(null)
    try {
      const report = await api.sendBroadcastNotification({
        subject: emailSubject.trim() || 'Message from your salon',
        message: emailPlain.trim(),
        messageHtml: emailHtml || emailPlain.trim(),
        channels: ['email'],
        filters: emailAudience.filterPayload,
      })
      setEmailReport(report)
      if (report.reached) toast.success(`Emailed ${report.reached} of ${report.matched ?? report.total}`)
      if (report.unsent.length) toast.error(`${report.unsent.length} could not be emailed`)
      await refreshHistory()
    } catch (err: any) {
      toast.error(err.message || 'Could not send bulk email')
    } finally {
      setBroadcastingEmail(false)
    }
  }

  const sendOneWhatsapp = async () => {
    if (!waMessage.trim()) {
      toast.error('Enter a WhatsApp message')
      return
    }
    if (!waPhone.trim()) {
      toast.error('Enter the WhatsApp number to send to')
      return
    }
    setSendingWa(true)
    try {
      const res = await api.sendCustomNotification({
        customerId: waCustomerId || null,
        name: waName.trim() || waPhone.trim(),
        email: null,
        phone: waPhone.trim(),
        channels: ['whatsapp'],
        subject: 'Message from your salon',
        message: waMessage.trim(),
      })
      const failure = res.results.find((item) => !item.ok)
      if (failure) toast.error(failure.error || 'WhatsApp failed')
      else {
        toast.success('WhatsApp sent')
        setWaMessage('')
      }
      await refreshHistory()
    } catch (err: any) {
      toast.error(err.message || 'Could not send WhatsApp')
    } finally {
      setSendingWa(false)
    }
  }

  const sendBulkWhatsapp = async () => {
    if (!waMessage.trim()) {
      toast.error('Enter a WhatsApp message')
      return
    }
    const count = waAudience.audience?.matched ?? customers.length
    if (!count) {
      toast.error(waAudience.hasFilter ? 'No customers match these filters' : 'There are no customers in the phonebook yet')
      return
    }
    if (!window.confirm(`Send this WhatsApp to ${count} matching customer${count === 1 ? '' : 's'}? Only contacts with a valid number will get WhatsApp.`)) {
      return
    }
    setBroadcastingWa(true)
    setWaReport(null)
    try {
      const report = await api.sendBroadcastNotification({
        subject: 'Message from your salon',
        message: waMessage.trim(),
        channels: ['whatsapp'],
        filters: waAudience.filterPayload,
      })
      setWaReport(report)
      if (report.reached) toast.success(`WhatsApped ${report.reached} of ${report.matched ?? report.total}`)
      if (report.unsent.length) toast.error(`${report.unsent.length} could not be reached on WhatsApp`)
      await refreshHistory()
    } catch (err: any) {
      toast.error(err.message || 'Could not send bulk WhatsApp')
    } finally {
      setBroadcastingWa(false)
    }
  }

  const Row = ({ ok, label, error }: { ok?: boolean; label: string; error?: string }) => (
    <p className={`text-xs ${ok ? 'text-green-600' : 'text-amber-600'}`}>
      {ok ? '✓' : '⚠'} {label}
      {error ? ` — ${error}` : ''}
    </p>
  )

  const inputCls = 'w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800'

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
        <div>
          <h2 className="text-lg font-semibold">Email</h2>
          <p className="text-sm text-gray-500">Send to one person, or switch to a filtered group for bulk email.</p>
        </div>
        <ModeToggle mode={emailMode} onChange={setEmailMode} />

        {emailMode === 'individual' ? (
          <>
            <div>
              <label className="block text-sm font-medium mb-1">Saved customer (optional)</label>
              <select value={emailCustomerId} onChange={(e) => applyEmailCustomer(e.target.value)} className={inputCls}>
                <option value="">Type an email below</option>
                {customers.filter((c) => c.email).map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name} · {customer.email}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <input value={emailName} onChange={(e) => setEmailName(e.target.value)} placeholder="Customer name" className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <input type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="customer@example.com" className={inputCls} />
              </div>
            </div>
          </>
        ) : (
          <AudienceFilters
            filterOptions={filterOptions}
            filterService={emailFilterService}
            setFilterService={setEmailFilterService}
            filterAttrs={emailFilterAttrs}
            setFilterAttrs={setEmailFilterAttrs}
            audience={emailAudience.audience}
          />
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Subject</label>
          <input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Message</label>
          <RichMessageEditor
            valueHtml={emailHtml}
            onChange={(html, plain) => {
              setEmailHtml(html)
              setEmailPlain(plain)
            }}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {emailMode === 'individual' ? (
            <button onClick={sendOneEmail} disabled={sendingEmail || broadcastingEmail}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {sendingEmail ? 'Sending…' : 'Send email'}
            </button>
          ) : (
            <button onClick={sendBulkEmail} disabled={sendingEmail || broadcastingEmail}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {broadcastingEmail
                ? 'Sending emails…'
                : `Email ${emailAudience.audience?.matched ?? customers.length} matching`}
            </button>
          )}
        </div>
        {emailReport && emailMode === 'filtered' && <BroadcastSummary report={emailReport} channel="email" />}
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4 max-w-2xl">
        <div>
          <h2 className="text-lg font-semibold">WhatsApp</h2>
          <p className="text-sm text-gray-500">Send to one person, or switch to a filtered group for bulk WhatsApp. Plain text only.</p>
        </div>
        <ModeToggle mode={waMode} onChange={setWaMode} />

        {waMode === 'individual' ? (
          <>
            <div>
              <label className="block text-sm font-medium mb-1">Saved customer (optional)</label>
              <select value={waCustomerId} onChange={(e) => applyWaCustomer(e.target.value)} className={inputCls}>
                <option value="">Type a number below</option>
                {customers.filter((c) => c.phone).map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name} · {customer.phone}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <input value={waName} onChange={(e) => setWaName(e.target.value)} placeholder="Customer name" className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">WhatsApp number</label>
                <input value={waPhone} onChange={(e) => setWaPhone(e.target.value)} placeholder="+919876543210" className={inputCls} />
              </div>
            </div>
          </>
        ) : (
          <AudienceFilters
            filterOptions={filterOptions}
            filterService={waFilterService}
            setFilterService={setWaFilterService}
            filterAttrs={waFilterAttrs}
            setFilterAttrs={setWaFilterAttrs}
            audience={waAudience.audience}
          />
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Message</label>
          <textarea
            value={waMessage}
            onChange={(e) => setWaMessage(e.target.value)}
            rows={6}
            maxLength={3000}
            placeholder="Write the WhatsApp message"
            className={inputCls}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {waMode === 'individual' ? (
            <button onClick={sendOneWhatsapp} disabled={sendingWa || broadcastingWa}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {sendingWa ? 'Sending…' : 'Send WhatsApp'}
            </button>
          ) : (
            <button onClick={sendBulkWhatsapp} disabled={sendingWa || broadcastingWa}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {broadcastingWa
                ? 'Sending WhatsApp…'
                : `WhatsApp ${waAudience.audience?.matched ?? customers.length} matching`}
            </button>
          )}
        </div>
        {waReport && waMode === 'filtered' && <BroadcastSummary report={waReport} channel="whatsapp" />}
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
