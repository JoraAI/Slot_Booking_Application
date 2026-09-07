import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import toast from 'react-hot-toast'
import type {
  EligibleBookingForInvoice,
  InvoiceLineItem,
  InvoiceListItem,
  Product,
  Service,
} from '../../types'

const iso = (d: Date) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const SOURCE_LABELS: Record<string, string> = {
  booking_paid: 'Paid booking',
  booking_completed: 'Completed booking',
  walk_in: 'Walk-in',
  manual: 'Manual',
}

type SelectedLine = {
  key: string
  kind: 'service' | 'product' | 'custom'
  id?: string
  description: string
  quantity: number
  unitPrice: number
}

function hasContact(inv: { customerPhone?: string | null; customerEmail?: string | null }) {
  return Boolean(String(inv.customerPhone || '').trim() || String(inv.customerEmail || '').trim())
}

export const InvoicesPage: React.FC = () => {
  const [searchParams] = useSearchParams()
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([])
  const [eligible, setEligible] = useState<EligibleBookingForInvoice[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState(
    searchParams.get('dateFrom') || iso(new Date(Date.now() - 30 * 86400000)),
  )
  const [dateTo, setDateTo] = useState(searchParams.get('dateTo') || iso(new Date()))
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    paymentMethod: 'cash' as 'cash' | 'upi' | 'card' | 'other',
    notes: '',
    customDescription: '',
    customAmount: '',
    discountEnabled: false,
    discountType: 'PERCENTAGE' as 'PERCENTAGE' | 'FLAT',
    discountValue: '',
  })
  const [selected, setSelected] = useState<Record<string, SelectedLine>>({})

  const load = async () => {
    setLoading(true)
    try {
      const [inv, elig, svc, prod] = await Promise.all([
        api.getInvoices({ dateFrom, dateTo }),
        api.getEligibleInvoiceBookings(),
        api.getServices().catch(() => [] as Service[]),
        api.getProducts().catch(() => [] as Product[]),
      ])
      setInvoices(inv)
      setEligible(elig.bookings)
      setServices((svc || []).filter((s) => s.isActive !== false))
      setProducts((prod || []).filter((p) => p.isActive !== false))
    } catch (e: any) {
      toast.error(e.message || 'Could not load invoices')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [dateFrom, dateTo])

  const selectedLines = useMemo(() => Object.values(selected), [selected])
  const subtotal = useMemo(
    () => selectedLines.reduce((sum, row) => sum + row.quantity * row.unitPrice, 0),
    [selectedLines],
  )
  const discountPreview = useMemo(() => {
    if (!form.discountEnabled) return 0
    const value = Number(form.discountValue)
    if (!Number.isFinite(value) || value <= 0 || subtotal <= 0) return 0
    if (form.discountType === 'PERCENTAGE') {
      return Math.min(subtotal, Math.round(((subtotal * Math.min(100, value)) / 100) * 100) / 100)
    }
    return Math.min(subtotal, Math.round(value * 100) / 100)
  }, [form.discountEnabled, form.discountType, form.discountValue, subtotal])
  const total = Math.max(0, Math.round((subtotal - discountPreview) * 100) / 100)

  const emptyForm = {
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    paymentMethod: 'cash' as const,
    notes: '',
    customDescription: '',
    customAmount: '',
    discountEnabled: false,
    discountType: 'PERCENTAGE' as const,
    discountValue: '',
  }
  const toggleCatalogItem = (kind: 'service' | 'product', item: { id: string; name: string; price: number }) => {
    const key = `${kind}:${item.id}`
    setSelected((prev) => {
      if (prev[key]) {
        const next = { ...prev }
        delete next[key]
        return next
      }
      return {
        ...prev,
        [key]: {
          key,
          kind,
          id: item.id,
          description: item.name,
          quantity: 1,
          unitPrice: Number(item.price) || 0,
        },
      }
    })
  }

  const addCustomLine = () => {
    const description = form.customDescription.trim()
    const unitPrice = Number(form.customAmount)
    if (!description || !Number.isFinite(unitPrice) || unitPrice < 0) {
      toast.error('Enter a custom description and amount')
      return
    }
    const key = `custom:${Date.now()}`
    setSelected((prev) => ({
      ...prev,
      [key]: { key, kind: 'custom', description, quantity: 1, unitPrice },
    }))
    setForm((p) => ({ ...p, customDescription: '', customAmount: '' }))
  }

  const openInvoice = async (id: string) => {
    try {
      await api.openInvoiceHtml(id)
    } catch (e: any) {
      toast.error(e.message || 'Could not open invoice')
    }
  }

  const sendInvoice = async (inv: InvoiceListItem, channels: Array<'email' | 'whatsapp'>) => {
    setSendingId(inv.id)
    try {
      const res = await api.sendInvoice(inv.id, channels)
      const failed = res.results.filter((r) => !r.ok)
      const ok = res.results.filter((r) => r.ok)
      if (ok.length) toast.success(`Sent via ${ok.map((r) => r.channel).join(' + ')}`)
      for (const f of failed) toast.error(`${f.channel}: ${f.error || 'failed'}`)
    } catch (e: any) {
      toast.error(e.message || 'Could not send invoice')
    } finally {
      setSendingId(null)
    }
  }

  const issueForBooking = async (booking: EligibleBookingForInvoice) => {
    const defaultAmount = booking.finalPrice ?? booking.originalPrice ?? 0
    const input = window.prompt(`Invoice amount (₹) for ${booking.customerName}`, String(defaultAmount || ''))
    if (input === null) return
    const amount = Number(input)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    setSaving(true)
    try {
      const inv = await api.issueBookingInvoice(booking.id, { amount, paymentMethod: 'cash' })
      toast.success(`Invoice ${inv.invoiceNumber} created`)
      load()
    } catch (e: any) {
      toast.error(e.message || 'Could not create invoice')
    } finally {
      setSaving(false)
    }
  }

  const createWalkIn = async () => {
    if (!form.customerName.trim()) {
      toast.error('Customer name is required')
      return
    }
    if (!selectedLines.length) {
      toast.error('Select at least one service or product')
      return
    }
    const lineItems: InvoiceLineItem[] = selectedLines.map((row) => ({
      description: row.description,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      amount: Number((row.quantity * row.unitPrice).toFixed(2)),
    }))
    if (lineItems.some((row) => row.amount < 0) || total <= 0) {
      toast.error('Invoice total must be greater than zero')
      return
    }
    if (form.discountEnabled) {
      const value = Number(form.discountValue)
      if (!Number.isFinite(value) || value <= 0) {
        toast.error('Enter a discount value greater than zero, or turn discount off')
        return
      }
      if (form.discountType === 'PERCENTAGE' && value > 100) {
        toast.error('Percentage discount cannot exceed 100%')
        return
      }
    }
    setSaving(true)
    try {
      const inv = await api.createWalkInInvoice({
        customerName: form.customerName.trim(),
        customerPhone: form.customerPhone.trim() || null,
        customerEmail: form.customerEmail.trim() || null,
        lineItems,
        paymentMethod: form.paymentMethod,
        notes: form.notes.trim() || null,
        discountType: form.discountEnabled ? form.discountType : null,
        discountValue: form.discountEnabled ? Number(form.discountValue) : null,
      })
      toast.success(`Invoice ${inv.invoiceNumber} created`)
      setShowForm(false)
      setSelected({})
      setForm({ ...emptyForm })
      load()
    } catch (e: any) {
      toast.error(e.message || 'Could not create invoice')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800'

  const actionButtons = (inv: InvoiceListItem) => {
    const phone = String(inv.customerPhone || '').trim()
    const email = String(inv.customerEmail || '').trim()
    const busy = sendingId === inv.id
    return (
      <div className="flex flex-wrap gap-2 justify-end">
        <button onClick={() => openInvoice(inv.id)} className="text-sm px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">
          View / Download
        </button>
        {email && (
          <button
            disabled={busy}
            onClick={() => sendInvoice(inv, ['email'])}
            className="text-sm px-3 py-1.5 border border-primary/30 text-primary rounded-lg hover:bg-primary/5 disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Send email'}
          </button>
        )}
        {phone && (
          <button
            disabled={busy}
            onClick={() => sendInvoice(inv, ['whatsapp'])}
            className="text-sm px-3 py-1.5 border border-emerald-300 text-emerald-700 dark:text-emerald-400 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Send WhatsApp'}
          </button>
        )}
        {email && phone && (
          <button
            disabled={busy}
            onClick={() => sendInvoice(inv, ['email', 'whatsapp'])}
            className="text-sm px-3 py-1.5 bg-primary text-white rounded-lg disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Send both'}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Invoices</h1>
          <p className="text-sm text-gray-500 mt-1">Issue invoices for walk-ins or completed bookings without online payment.</p>
        </div>
        <button onClick={() => setShowForm(true)} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90">
          + New walk-in invoice
        </button>
      </div>

      {eligible.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 space-y-3">
          <h2 className="font-semibold text-sm">Completed bookings awaiting invoice ({eligible.length})</h2>
          <p className="text-xs text-gray-600 dark:text-gray-300">These appointments were marked completed but were not paid online.</p>
          <div className="space-y-2">
            {eligible.map((b) => (
              <div key={b.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-white dark:bg-gray-900 border border-amber-100 dark:border-amber-900 rounded-lg p-3">
                <div className="text-sm">
                  <p className="font-medium">{b.customerName}</p>
                  <p className="text-gray-500">{b.serviceNameSnapshot || 'Service'} · {new Date(b.date).toLocaleDateString('en-IN')} · {b.startTime}</p>
                </div>
                <button onClick={() => issueForBooking(b)} disabled={saving} className="px-3 py-2 text-sm border border-amber-300 rounded-lg hover:bg-amber-50 disabled:opacity-50">
                  Issue invoice
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputCls} />
        <button onClick={load} className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Refresh</button>
      </div>

      {loading ? (
        <div className="skeleton h-40" />
      ) : invoices.length === 0 ? (
        <div className="text-center py-12 text-sm text-gray-500 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
          No invoices in this date range.
        </div>
      ) : (
        <>
          <div className="hidden md:block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="px-4 py-3 font-medium">{inv.invoiceNumber}</td>
                    <td className="px-4 py-3">
                      <div>{inv.customerName}</div>
                      {!hasContact(inv) && <div className="text-xs text-gray-400">No email/phone — download only</div>}
                    </td>
                    <td className="px-4 py-3">{SOURCE_LABELS[inv.source] || inv.source}</td>
                    <td className="px-4 py-3">₹{inv.total.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3">{new Date(inv.issuedAt).toLocaleDateString('en-IN')}</td>
                    <td className="px-4 py-3">{actionButtons(inv)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {invoices.map((inv) => (
              <div key={inv.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{inv.invoiceNumber}</p>
                    <p className="text-sm text-gray-500">{inv.customerName}</p>
                  </div>
                  <p className="font-semibold">₹{inv.total.toLocaleString('en-IN')}</p>
                </div>
                <p className="text-xs text-gray-500">{SOURCE_LABELS[inv.source] || inv.source} · {new Date(inv.issuedAt).toLocaleDateString('en-IN')}</p>
                {!hasContact(inv) && <p className="text-xs text-gray-400">No email/phone — download only</p>}
                {actionButtons(inv)}
              </div>
            ))}
          </div>
        </>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Walk-in invoice</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">Customer name *</label>
                <input value={form.customerName} onChange={(e) => setForm(p => ({ ...p, customerName: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Phone (for WhatsApp send)</label>
                <input value={form.customerPhone} onChange={(e) => setForm(p => ({ ...p, customerPhone: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Email (for email send)</label>
                <input type="email" value={form.customerEmail} onChange={(e) => setForm(p => ({ ...p, customerEmail: e.target.value }))} className={inputCls} />
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Services</h3>
              {services.length === 0 ? (
                <p className="text-xs text-gray-500">No active services. Add services under Services, or use a custom line.</p>
              ) : (
                <div className="max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
                  {services.map((s) => {
                    const key = `service:${s.id}`
                    const checked = Boolean(selected[key])
                    return (
                      <label key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                        <input type="checkbox" checked={checked} onChange={() => toggleCatalogItem('service', s)} className="rounded border-gray-300" />
                        <span className="flex-1">{s.name}</span>
                        <span className="text-gray-500">₹{Number(s.price).toLocaleString('en-IN')}</span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Products</h3>
              {products.length === 0 ? (
                <p className="text-xs text-gray-500">No active products. Add products under Products, or use a custom line.</p>
              ) : (
                <div className="max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
                  {products.map((p) => {
                    const key = `product:${p.id}`
                    const checked = Boolean(selected[key])
                    return (
                      <label key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                        <input type="checkbox" checked={checked} onChange={() => toggleCatalogItem('product', p)} className="rounded border-gray-300" />
                        <span className="flex-1">{p.name}</span>
                        <span className="text-gray-500">₹{Number(p.price).toLocaleString('en-IN')}</span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="space-y-2 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg p-3">
              <h3 className="text-sm font-semibold">Custom line (optional)</h3>
              <div className="grid sm:grid-cols-3 gap-2">
                <input
                  value={form.customDescription}
                  onChange={(e) => setForm((p) => ({ ...p, customDescription: e.target.value }))}
                  placeholder="Description"
                  className={`${inputCls} sm:col-span-2`}
                />
                <input
                  type="number"
                  min={0}
                  value={form.customAmount}
                  onChange={(e) => setForm((p) => ({ ...p, customAmount: e.target.value }))}
                  placeholder="₹ amount"
                  className={inputCls}
                />
              </div>
              <button type="button" onClick={addCustomLine} className="text-sm text-primary hover:underline">
                + Add custom line
              </button>
            </div>

            {selectedLines.length > 0 && (
              <div className="bg-gray-50 dark:bg-gray-800/60 rounded-lg p-3 space-y-2 text-sm">
                <h3 className="font-semibold text-xs uppercase text-gray-500">Selected lines</h3>
                {selectedLines.map((row) => (
                  <div key={row.key} className="flex items-center gap-2">
                    <span className="flex-1 truncate">{row.description}</span>
                    <input
                      type="number"
                      min={1}
                      value={row.quantity}
                      onChange={(e) => {
                        const quantity = Math.max(1, Number(e.target.value) || 1)
                        setSelected((prev) => ({ ...prev, [row.key]: { ...row, quantity } }))
                      }}
                      className="w-16 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded text-sm bg-white dark:bg-gray-900"
                    />
                    <span className="w-20 text-right">₹{(row.quantity * row.unitPrice).toLocaleString('en-IN')}</span>
                    <button
                      type="button"
                      onClick={() => setSelected((prev) => {
                        const next = { ...prev }
                        delete next[row.key]
                        return next
                      })}
                      className="text-xs text-red-500"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <div className="border-t border-gray-200 dark:border-gray-700 pt-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setForm((p) => ({ ...p, discountEnabled: !p.discountEnabled }))}
                        className={`relative inline-block w-9 h-5 shrink-0 rounded-full transition-colors ${
                          form.discountEnabled ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-700'
                        }`}
                        aria-pressed={form.discountEnabled}
                        aria-label="Toggle discount"
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                            form.discountEnabled ? 'translate-x-4' : ''
                          }`}
                        />
                      </button>
                      <span className="text-sm font-medium">Discount</span>
                    </div>
                    {form.discountEnabled && (
                      <div className="flex rounded-lg bg-gray-100 dark:bg-gray-900 p-0.5">
                        {(['PERCENTAGE', 'FLAT'] as const).map((type) => (
                          <button
                            key={type}
                            type="button"
                            onClick={() => setForm((p) => ({ ...p, discountType: type }))}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                              form.discountType === type
                                ? 'bg-white dark:bg-gray-800 shadow text-primary'
                                : 'text-gray-500'
                            }`}
                          >
                            {type === 'PERCENTAGE' ? '%' : '₹'}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {form.discountEnabled && (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        max={form.discountType === 'PERCENTAGE' ? 100 : undefined}
                        step="any"
                        value={form.discountValue}
                        onChange={(e) => setForm((p) => ({ ...p, discountValue: e.target.value }))}
                        placeholder={form.discountType === 'PERCENTAGE' ? 'e.g. 10' : 'e.g. 100'}
                        className={`${inputCls} flex-1`}
                      />
                      <span className="text-sm text-gray-500 w-8 shrink-0">
                        {form.discountType === 'PERCENTAGE' ? '%' : '₹'}
                      </span>
                    </div>
                  )}
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between text-gray-500">
                      <span>Subtotal</span>
                      <span>₹{subtotal.toLocaleString('en-IN')}</span>
                    </div>
                    {discountPreview > 0 && (
                      <div className="flex justify-between text-emerald-600">
                        <span>
                          Discount
                          {form.discountType === 'PERCENTAGE' && form.discountValue
                            ? ` (${form.discountValue}%)`
                            : ''}
                        </span>
                        <span>- ₹{discountPreview.toLocaleString('en-IN')}</span>
                      </div>
                    )}
                    <p className="font-semibold text-right pt-1">Total: ₹{total.toLocaleString('en-IN')}</p>
                  </div>
                </div>
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Payment method</label>
                <select value={form.paymentMethod} onChange={(e) => setForm(p => ({ ...p, paymentMethod: e.target.value as any }))} className={inputCls}>
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="card">Card</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">Notes</label>
                <textarea value={form.notes} onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} className={inputCls} />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm">Cancel</button>
              <button onClick={createWalkIn} disabled={saving} className="flex-1 py-2.5 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">
                {saving ? 'Saving…' : 'Create invoice'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
