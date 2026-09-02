import React, { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import toast from 'react-hot-toast'
import type { EligibleBookingForInvoice, InvoiceLineItem, InvoiceListItem } from '../../types'

const iso = (d: Date) => d.toISOString().slice(0, 10)

const SOURCE_LABELS: Record<string, string> = {
  booking_paid: 'Paid booking',
  booking_completed: 'Completed booking',
  walk_in: 'Walk-in',
  manual: 'Manual',
}

export const InvoicesPage: React.FC = () => {
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([])
  const [eligible, setEligible] = useState<EligibleBookingForInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState(iso(new Date(Date.now() - 30 * 86400000)))
  const [dateTo, setDateTo] = useState(iso(new Date()))
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    description: '',
    amount: '',
    paymentMethod: 'cash' as 'cash' | 'upi' | 'card' | 'other',
    notes: '',
  })

  const load = async () => {
    setLoading(true)
    try {
      const [inv, elig] = await Promise.all([
        api.getInvoices({ dateFrom, dateTo }),
        api.getEligibleInvoiceBookings(),
      ])
      setInvoices(inv)
      setEligible(elig.bookings)
    } catch (e: any) {
      toast.error(e.message || 'Could not load invoices')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [dateFrom, dateTo])

  const openInvoice = async (id: string) => {
    try {
      await api.openInvoiceHtml(id)
    } catch (e: any) {
      toast.error(e.message || 'Could not open invoice')
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
    const amount = Number(form.amount)
    if (!form.customerName.trim() || !form.description.trim() || !Number.isFinite(amount) || amount <= 0) {
      toast.error('Customer name, description, and amount are required')
      return
    }
    const lineItems: InvoiceLineItem[] = [{
      description: form.description.trim(),
      quantity: 1,
      unitPrice: amount,
      amount,
    }]
    setSaving(true)
    try {
      const inv = await api.createWalkInInvoice({
        customerName: form.customerName.trim(),
        customerPhone: form.customerPhone.trim() || null,
        customerEmail: form.customerEmail.trim() || null,
        lineItems,
        paymentMethod: form.paymentMethod,
        notes: form.notes.trim() || null,
      })
      toast.success(`Invoice ${inv.invoiceNumber} created`)
      setShowForm(false)
      setForm({ customerName: '', customerPhone: '', customerEmail: '', description: '', amount: '', paymentMethod: 'cash', notes: '' })
      load()
    } catch (e: any) {
      toast.error(e.message || 'Could not create invoice')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800'

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
                    <td className="px-4 py-3">{inv.customerName}</td>
                    <td className="px-4 py-3">{SOURCE_LABELS[inv.source] || inv.source}</td>
                    <td className="px-4 py-3">₹{inv.total.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3">{new Date(inv.issuedAt).toLocaleDateString('en-IN')}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => openInvoice(inv.id)} className="text-primary hover:underline">View</button>
                    </td>
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
                <button onClick={() => openInvoice(inv.id)} className="w-full py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg">View / Print</button>
              </div>
            ))}
          </div>
        </>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
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
                <label className="block text-xs font-medium mb-1">Phone</label>
                <input value={form.customerPhone} onChange={(e) => setForm(p => ({ ...p, customerPhone: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Email</label>
                <input type="email" value={form.customerEmail} onChange={(e) => setForm(p => ({ ...p, customerEmail: e.target.value }))} className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">Service / product description *</label>
                <input value={form.description} onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))} className={inputCls} placeholder="Haircut, product sale, etc." />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Amount (₹) *</label>
                <input type="number" min={1} value={form.amount} onChange={(e) => setForm(p => ({ ...p, amount: e.target.value }))} className={inputCls} />
              </div>
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
