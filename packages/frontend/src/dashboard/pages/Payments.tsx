import React, { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import type { Booking } from '../../types'
import { Link } from 'react-router-dom'

const STATUS_COLORS: Record<string, string> = {
  paid: 'bg-green-100 text-green-700',
  partial: 'bg-amber-100 text-amber-700',
  pending: 'bg-gray-100 text-gray-600',
  refunded: 'bg-red-100 text-red-700',
  refund_pending: 'bg-blue-100 text-blue-700',
  refund_failed: 'bg-red-100 text-red-700',
}

const STATUS_LABELS: Record<string, string> = {
  paid: 'Paid',
  partial: 'Partial',
  pending: 'Pending',
  refunded: 'Refunded',
  refund_pending: 'Refund pending',
  refund_failed: 'Refund failed',
}

export const PaymentsPage: React.FC = () => {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.getPayments({ limit: '100' })
      setBookings(res.bookings)
      setTotal(res.total)
    } catch (e: any) {
      setError(e.message || 'Failed to load payments')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const REFUND_STATES = new Set(['refunded', 'refund_pending', 'refund_failed'])
  // "Collected" is net of refunds: a refunded/refund_pending/refund_failed
  // transaction is not currently-collected revenue.
  const collected = bookings.reduce(
    (s, b) => s + ((b.paymentStatus === 'paid' || b.paymentStatus === 'partial') && !REFUND_STATES.has(b.paymentStatus || '') ? (b.paymentAmount || 0) : 0),
    0
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Payments</h1>
          <p className="text-sm text-gray-500 mt-1">Collected: ₹{collected.toLocaleString('en-IN')}</p>
        </div>
        <button onClick={load} className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50">Refresh</button>
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 text-sm">
        <p className="font-medium">Where does the money go?</p>
        <p className="text-gray-600 dark:text-gray-300 mt-1">
          Live payments use the owner's Razorpay API keys and settle to the verified bank account
          linked to that Razorpay account. A UPI ID entered in Reservly cannot redirect Razorpay settlements.
        </p>
        <div className="flex gap-4 mt-2">
          <Link to="/dashboard/settings" className="text-primary underline">Payment settings</Link>
          <Link to="/dashboard/setup-guide#payments" className="text-primary underline">Setup steps</Link>
        </div>
      </div>

      {loading && <div className="skeleton h-40" />}

      {error && !loading && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-sm text-red-600">
          {error}
          <button onClick={load} className="ml-3 underline">Retry</button>
        </div>
      )}

      {!loading && !error && bookings.length === 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
          <p className="text-3xl mb-2">💳</p>
          <p className="text-gray-500">No payment transactions yet.</p>
        </div>
      )}

      {!loading && bookings.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {bookings.map((b) => (
              <div key={b.id} className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">{b.serviceNameSnapshot || 'Appointment'}</p>
                  <p className="text-xs text-gray-400 truncate">
                    {b.customerName} · {b.date.slice(0, 10)} · {b.startTime}{b.staff?.name ? ` · ${b.staff.name}` : ''}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-semibold">₹{(b.paymentAmount || 0).toLocaleString('en-IN')}</p>
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[b.paymentStatus || 'pending'] || STATUS_COLORS.pending}`}>
                    {STATUS_LABELS[b.paymentStatus || 'pending'] || b.paymentStatus || 'pending'}
                  </span>
                  {(() => {
                    const refundRow = (b as any).paymentRefund
                    if (!refundRow) return null
                    return (
                      <p className="text-[11px] text-gray-400 mt-1">
                        {refundRow.status === 'FAILED'
                          ? '⚠️ Refund failed — manual action'
                          : `Refund ${String(refundRow.status).toLowerCase()}`}
                      </p>
                    )
                  })()}
                </div>
              </div>
            ))}
          </div>
          <p className="px-4 py-3 text-xs text-gray-400 border-t border-gray-100 dark:border-gray-800">{total} payment{total === 1 ? '' : 's'}</p>
        </div>
      )}
    </div>
  )
}
