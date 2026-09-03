import React, { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import type { Booking } from '../../types'

function fmtDate(d: string | Date) {
  return String(d).split('T')[0]
}

function formatAnswerValue(value: unknown): string {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

const STATUS_BADGE: Record<string, string> = {
  CONFIRMED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
  COMPLETED: 'bg-blue-100 text-blue-700',
  NO_SHOW: 'bg-amber-100 text-amber-700',
}

function StatusActions({ booking, onStatus }: { booking: Booking; onStatus: (id: string, status: string) => void }) {
  if (booking.status !== 'CONFIRMED') return null
  return (
    <div className="flex flex-wrap gap-2">
      <button onClick={() => onStatus(booking.id, 'COMPLETED')} className="text-xs px-3 py-1.5 bg-green-100 text-green-700 rounded-lg hover:bg-green-200">Complete</button>
      <button onClick={() => onStatus(booking.id, 'NO_SHOW')} className="text-xs px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200">No Show</button>
      <button onClick={() => onStatus(booking.id, 'CANCELLED')} className="text-xs px-3 py-1.5 bg-red-100 text-red-700 rounded-lg hover:bg-red-200">Cancel</button>
    </div>
  )
}

export const Bookings: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState(searchParams.get('status') || '')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Booking | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const analyticsFrom = searchParams.get('dateFrom') || ''
  const analyticsTo = searchParams.get('dateTo') || ''
  const analyticsStatus = searchParams.get('status') || ''
  const analyticsSource = searchParams.get('source') || ''
  const analyticsServiceId = searchParams.get('serviceId') || ''
  const fromAnalytics = !!(analyticsFrom || analyticsTo || analyticsSource || analyticsServiceId)

  useEffect(() => {
    setLoading(true)
    const params: Record<string, string> = {}
    if (analyticsFrom) params.dateFrom = analyticsFrom
    if (analyticsTo) params.dateTo = analyticsTo
    if (filter) params.status = filter
    else if (analyticsStatus) params.status = analyticsStatus
    if (analyticsSource) params.source = analyticsSource
    if (analyticsServiceId) params.serviceId = analyticsServiceId
    if (fromAnalytics) params.limit = '500'
    api.getOwnerBookings(Object.keys(params).length ? params : undefined)
      .then((data) => setBookings(data.bookings))
      .catch(() => setBookings([]))
      .finally(() => setLoading(false))
  }, [analyticsFrom, analyticsTo, analyticsStatus, analyticsSource, analyticsServiceId, filter, fromAnalytics])

  const changeStatusFilter = (status: string) => {
    setFilter(status)
    const next = new URLSearchParams(searchParams)
    if (status) next.set('status', status)
    else next.delete('status')
    setSearchParams(next, { replace: true })
  }

  const analyticsBackHref = (() => {
    const q = new URLSearchParams()
    if (analyticsFrom) q.set('dateFrom', analyticsFrom)
    if (analyticsTo) q.set('dateTo', analyticsTo)
    const qs = q.toString()
    return qs ? `/dashboard/analytics?${qs}` : '/dashboard/analytics'
  })()

  const openDetail = async (id: string) => {
    setSelectedId(id)
    setDetail(null)
    setDetailLoading(true)
    try {
      const b = await api.getOwnerBooking(id)
      setDetail(b)
      setBookings((prev) => prev.map((x) => (x.id === id ? { ...x, ...b } : x)))
    } catch {
      setSelectedId(null)
    } finally {
      setDetailLoading(false)
    }
  }

  const closeDetail = () => {
    setSelectedId(null)
    setDetail(null)
  }

  const handleStatusChange = async (id: string, status: string) => {
    try {
      await api.updateOwnerBooking(id, { status })
      const patch = { ...(detail?.id === id ? detail : {}), status } as Partial<Booking>
      setBookings((prev) => prev.map((b) => b.id === id ? { ...b, status: status as Booking['status'] } : b))
      if (detail?.id === id) setDetail((d) => (d ? { ...d, ...patch } : d))
    } catch { /* keep current state */ }
  }

  if (selectedId) {
    const b = detail
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <button onClick={closeDetail} className="w-full sm:w-auto text-sm px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">
              ← Back to list
            </button>
            <h1 className="text-xl sm:text-2xl font-bold">Booking detail</h1>
          </div>
          {b && (
            <span className={`self-start px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[b.status] || 'bg-gray-100 text-gray-700'}`}>{b.status}</span>
          )}
        </div>

        {detailLoading && <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center text-gray-400">Loading...</div>}
        {!detailLoading && !b && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center text-gray-400">Booking not found.</div>
        )}
        {b && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 sm:p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
              <div>
                <p className="text-xs text-gray-400">Customer</p>
                <p className="font-medium">{b.customerName}</p>
                <p className="text-gray-500 break-all">{b.customerPhone}</p>
                {b.customerEmail && <p className="text-gray-500 break-all">{b.customerEmail}</p>}
              </div>
              <div>
                <p className="text-xs text-gray-400">Service</p>
                <p className="font-medium">{b.serviceNameSnapshot || b.service?.name || '—'}</p>
                {b.durationMinutesSnapshot ? <p className="text-gray-500">{b.durationMinutesSnapshot} min</p> : null}
              </div>
              <div>
                <p className="text-xs text-gray-400">Staff</p>
                <p className="font-medium">{b.staff?.name || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">When</p>
                <p className="font-medium">{fmtDate(b.date)} · {b.startTime} - {b.endTime}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Amount</p>
                <p className="font-medium">₹{b.finalPrice != null ? b.finalPrice.toLocaleString('en-IN') : '—'}</p>
                {b.originalPrice != null && b.discountAmount != null && b.discountAmount > 0 && (
                  <p className="text-gray-500">was ₹{b.originalPrice.toLocaleString('en-IN')} · discount ₹{b.discountAmount.toLocaleString('en-IN')}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-gray-400">Payment</p>
                <p className="font-medium">{b.paymentStatus ? String(b.paymentStatus) : '—'}{b.paymentAmount != null ? ` · ₹${b.paymentAmount.toLocaleString('en-IN')}` : ''}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Source</p>
                <p className="font-medium">{b.source || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Booking ID</p>
                <p className="font-mono text-xs break-all">{b.id}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Created</p>
                <p className="font-medium">{b.createdAt ? new Date(b.createdAt).toLocaleString() : '—'}</p>
              </div>
            </div>

            <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
              <p className="text-xs text-gray-400 mb-2">Form answers</p>
              {!(b.formAnswers?.length) ? (
                <p className="text-sm text-gray-400">No form data.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  {b.formAnswers.map((row) => (
                    <div key={row.fieldId}>
                      <span className="text-gray-500">{row.label}: </span>
                      <span className="font-medium break-words">{formatAnswerValue(row.value)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
              <p className="text-xs text-gray-400 mb-2">Status actions</p>
              <StatusActions booking={b} onStatus={handleStatusChange} />
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Bookings</h1>
          <p className="text-xs text-gray-500 mt-0.5">Tap a booking for full details.</p>
        </div>
        <select value={filter || analyticsStatus} onChange={(e) => changeStatusFilter(e.target.value)}
          className="w-full sm:w-auto text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800">
          <option value="">All Status</option>
          <option value="CONFIRMED">Confirmed</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="COMPLETED">Completed</option>
          <option value="NO_SHOW">No Show</option>
        </select>
      </div>

      {fromAnalytics && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
          <p className="text-gray-700 dark:text-gray-200">
            Filtered from Analytics
            {analyticsFrom || analyticsTo ? ` · ${analyticsFrom || '…'} → ${analyticsTo || '…'}` : ''}
            {(filter || analyticsStatus) ? ` · ${filter || analyticsStatus}` : ''}
            {analyticsSource ? ` · source ${analyticsSource}` : ''}
          </p>
          <Link to={analyticsBackHref}
            className="w-full sm:w-auto text-center shrink-0 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-white dark:hover:bg-gray-800 font-medium">
            ← Back to Analytics
          </Link>
        </div>
      )}

      {loading ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center text-gray-400">Loading...</div>
      ) : bookings.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center text-gray-400">No bookings found</div>
      ) : (
        <>
          <div className="hidden md:block bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Customer</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Service</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Time</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {bookings.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer" onClick={() => void openDetail(b.id)}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{b.customerName}</p>
                      <p className="text-xs text-gray-400">{b.customerPhone}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{b.serviceNameSnapshot || b.service?.name || '—'}</p>
                      {b.staff?.name && <p className="text-xs text-gray-400">{b.staff.name}</p>}
                    </td>
                    <td className="px-4 py-3">{fmtDate(b.date)}</td>
                    <td className="px-4 py-3">{b.startTime} - {b.endTime}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[b.status] || 'bg-gray-100 text-gray-700'}`}>{b.status}</span>
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-wrap items-center gap-2">
                        <button onClick={() => void openDetail(b.id)} className="text-xs px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 font-medium text-primary">
                          View
                        </button>
                        <StatusActions booking={b} onStatus={handleStatusChange} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {bookings.map((b) => (
              <div key={b.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 space-y-3">
                <button type="button" onClick={() => void openDetail(b.id)} className="w-full text-left space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{b.customerName}</p>
                      <p className="text-xs text-gray-500">{b.customerPhone}</p>
                    </div>
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[b.status] || 'bg-gray-100 text-gray-700'}`}>{b.status}</span>
                  </div>
                  <p className="text-sm font-medium">{b.serviceNameSnapshot || b.service?.name || '—'}</p>
                  <p className="text-xs text-gray-500">{fmtDate(b.date)} · {b.startTime} - {b.endTime}{b.staff?.name ? ` · ${b.staff.name}` : ''}</p>
                </button>
                <button onClick={() => void openDetail(b.id)} className="w-full py-2.5 bg-primary text-white rounded-lg text-sm font-medium">
                  View details
                </button>
                <div onClick={(e) => e.stopPropagation()}>
                  <StatusActions booking={b} onStatus={handleStatusChange} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
