import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import type { AnalyticsData } from '../../types'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const RANGES = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past-upcoming', label: 'Last 30 Days + Upcoming' },
]

const iso = (d: Date) => d.toISOString().slice(0, 10)

// Metrics are keyed on the appointment date, so any range ending today excludes
// bookings that have not happened yet. `upcomingDays` matches the bookable horizon.
function rangeDays(range: string, upcomingDays: number): { dateFrom: string; dateTo: string } {
  const today = new Date()
  const from = new Date(today)
  const to = new Date(today)

  if (range === '7d') from.setDate(from.getDate() - 7)
  else if (range === '30d') from.setDate(from.getDate() - 30)
  else if (range === 'upcoming') to.setDate(to.getDate() + upcomingDays)
  else if (range === 'past-upcoming') {
    from.setDate(from.getDate() - 30)
    to.setDate(to.getDate() + upcomingDays)
  }

  return { dateFrom: iso(from), dateTo: iso(to) }
}

const STATUS_DRILL: Record<string, string> = {
  confirmed: 'CONFIRMED',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
  noShow: 'NO_SHOW',
}

export const Analytics: React.FC = () => {
  const { config } = useStore()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const upcomingDays = config?.bookingWindowDays || 30
  const [range, setRange] = useState('past-upcoming')
  const [customFrom, setCustomFrom] = useState(searchParams.get('dateFrom') || '')
  const [customTo, setCustomTo] = useState(searchParams.get('dateTo') || '')
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const preset = rangeDays(range, upcomingDays)
  const dateFrom = customFrom || preset.dateFrom
  const dateTo = customTo || preset.dateTo

  // Drill to Bookings pre-filtered by this Analytics range (+ optional filters).
  const drillBookings = (extra?: Record<string, string>) => {
    const params = new URLSearchParams({ dateFrom, dateTo, ...(extra || {}) })
    navigate(`/dashboard/bookings?${params.toString()}`)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await api.getAnalytics({ dateFrom, dateTo }))
    } catch (e: any) {
      setError(e.message || 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  const downloadCsv = async () => {
    setExporting(true)
    setError(null)
    try {
      if (dateFrom > dateTo) throw new Error('From date must be on or before To date')
      const blob = await api.exportAnalyticsCsv({ dateFrom, dateTo })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `bookings_${dateFrom}_${dateTo}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setError(e.message || 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const maxHeat = data ? Math.max(1, ...Object.values(data.heatmap).flatMap((d) => Object.values(d))) : 1
  const maxTrend = data && data.sparkline?.length ? Math.max(1, ...data.sparkline) : 1

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Analytics</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            By appointment date · {dateFrom} to {dateTo}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 w-full lg:w-auto">
          <select value={range} onChange={(e) => { setRange(e.target.value); setCustomFrom(''); setCustomTo('') }}
            className="w-full sm:w-auto text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800">
            {RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <div className="flex flex-col xs:flex-row sm:flex-row items-stretch sm:items-center gap-2">
            <span className="text-xs text-gray-400 sm:whitespace-nowrap">Custom:</span>
            <input type="date" value={customFrom} max={customTo || undefined}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="w-full sm:w-auto text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-2 bg-white dark:bg-gray-800" />
            <span className="hidden sm:inline text-xs text-gray-400">→</span>
            <input type="date" value={customTo} min={customFrom || undefined}
              onChange={(e) => setCustomTo(e.target.value)}
              className="w-full sm:w-auto text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-2 bg-white dark:bg-gray-800" />
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <button onClick={load} disabled={loading} className="w-full sm:w-auto text-sm px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg disabled:opacity-50">
              Refresh
            </button>
            <button onClick={() => void downloadCsv()} disabled={exporting || !data}
              className="w-full sm:w-auto text-sm px-3 py-2 bg-primary text-white rounded-lg font-medium disabled:opacity-50">
              {exporting ? 'Downloading…' : 'Download CSV'}
            </button>
          </div>
        </div>
      </div>

      {loading && <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-24" />)}</div>}

      {error && !loading && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-sm text-red-600">
          {error}
          <button onClick={load} className="ml-3 underline">Retry</button>
        </div>
      )}

      {data && !loading && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi label="Total Bookings" value={String(data.totalBookings ?? 0)} icon="📋" onClick={() => drillBookings()} />
            <Kpi label="Cancellation Rate" value={`${data.cancellationRate ?? 0}%`} icon="📉" onClick={() => drillBookings({ status: 'CANCELLED' })} />
            <Kpi label="Peak Hour" value={data.peakHour || '--'} icon="🕐" onClick={() => drillBookings()} hint="Click to see bookings in this range" />
            <Kpi label="Busiest Day" value={data.busiestDay || '--'} icon="📅" onClick={() => drillBookings()} hint="Click to see bookings in this range" />
          </div>

          {/* Collections: service + product */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <Kpi
              label="Total collections"
              hint="Services + product sales"
              value={`₹${(
                data.revenueMetrics?.totalCollections
                ?? ((data.revenueMetrics?.totalCollected ?? 0) + (data.productMetrics?.totalRevenue ?? 0))
              ).toLocaleString('en-IN')}`}
              icon="🏦"
            />
            <Kpi
              label="Service collections"
              hint="Paid bookings (not cancelled/refunded)"
              value={`₹${(data.revenueMetrics?.totalCollected ?? 0).toLocaleString('en-IN')}`}
              icon="💰"
              onClick={() => drillBookings()}
              drillLabel="View bookings →"
            />
            <Kpi
              label="Product collections"
              hint="Retail sales in this range"
              value={`₹${(
                data.revenueMetrics?.productCollected ?? data.productMetrics?.totalRevenue ?? 0
              ).toLocaleString('en-IN')}`}
              icon="🛍️"
              onClick={() => navigate(`/dashboard/products?dateFrom=${dateFrom}&dateTo=${dateTo}`)}
              drillLabel="View products →"
            />
            <Kpi label="QR Bookings" value={`${data.qrBooking?.count ?? 0} (${data.qrBooking?.rate ?? 0}%)`} icon="🔳" onClick={() => drillBookings({ source: 'QR' })} hint="QR-sourced bookings" />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <Kpi label="Avg Booking Value" value={`₹${(data.avgBookingValue ?? 0).toLocaleString('en-IN')}`} icon="🧾" />
            <Kpi label="Discounts Given" value={`₹${(data.revenueMetrics?.discountsGiven ?? 0).toLocaleString('en-IN')}`} icon="🏷️" />
          </div>

          {/* Heatmap */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
            <h2 className="text-lg font-semibold mb-4">Booking Heatmap</h2>
            <div className="overflow-x-auto">
              <div className="space-y-1 min-w-[560px]">
                {DAYS.map((day) => {
                  const hours = data.heatmap[day] || {}
                  return (
                    <div key={day} className="grid grid-cols-[110px_repeat(24,1fr)] gap-1 items-center">
                      <div className="text-xs text-gray-500 truncate">{day.slice(0, 3)}</div>
                      {Array.from({ length: 24 }, (_, h) => {
                        const key = `${String(h).padStart(2, '0')}:00`
                        const count = hours[key] || hours[`${String(h).padStart(2, '0')}:30`] || 0
                        const intensity = count ? Math.max(0.08, count / maxHeat) : 0
                        return (
                          <div
                            key={h}
                            title={`${day} ${key} — ${count} bookings`}
                            className="aspect-square rounded-sm"
                            style={{ backgroundColor: count ? `rgba(124,58,237,${intensity})` : 'rgb(243 244 246)' }}
                          />
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Trend sparkline + status */}
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
              <h2 className="text-lg font-semibold mb-4">Bookings (7 days ending {dateTo})</h2>
              <div className="flex items-end gap-1 h-28">
                {(data.sparkline || []).map((v, i) => (
                  <div key={i} className="flex-1 bg-primary/70 rounded-t" style={{ height: `${Math.max(4, (v / maxTrend) * 100)}%` }} title={String(v)} />
                ))}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
              <h2 className="text-lg font-semibold mb-4">Status Breakdown</h2>
              <div className="space-y-2">
                {Object.entries(data.statusBreakdown || {}).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-3 text-sm">
                    <span className="w-24 capitalize">{k === 'noShow' ? 'No show' : k}</span>
                    <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-2">
                      <div className="bg-primary rounded-full h-2" style={{ width: `${data.totalBookings ? (v / data.totalBookings) * 100 : 0}%` }} />
                    </div>
                    <button onClick={() => drillBookings({ status: STATUS_DRILL[k] || k.toUpperCase() })}
                      className="w-10 text-right font-medium hover:underline focus:outline-none focus:underline" title={`View ${k} bookings`}>
                      {v}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Services & sources */}
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
              <h2 className="text-lg font-semibold mb-4">By Service</h2>
              {(data.bookingsByService || []).length === 0 && <p className="text-sm text-gray-400">No bookings in this range.</p>}
              <div className="space-y-2">
                {(data.bookingsByService || []).map((s) => (
                  <button key={s.name} disabled={!s.id}
                    onClick={() => s.id && drillBookings({ serviceId: s.id })}
                    className="w-full flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5 sm:gap-3 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg px-2 py-2 disabled:hover:bg-transparent focus:outline-none focus:ring-2 focus:ring-primary"
                    title={s.id ? 'View bookings for this service' : ''}>
                    <span className="break-words">{s.name}</span>
                    <span className="text-gray-500 shrink-0">{s.count} · ₹{s.revenue.toLocaleString('en-IN')}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
              <h2 className="text-lg font-semibold mb-4">By Source</h2>
              {(data.bookingsBySource || []).length === 0 && <p className="text-sm text-gray-400">No bookings in this range.</p>}
              <div className="space-y-2">
                {(data.bookingsBySource || []).map((s) => (
                  <button key={s.source} type="button" onClick={() => drillBookings({ source: s.source })}
                    className="w-full flex items-center justify-between text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary"
                    title={`View ${s.source} bookings`}>
                    <span>{s.source}</span>
                    <span className="text-gray-500">{s.count}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Product sales */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 sm:p-6 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Product sales</h2>
                <p className="text-xs text-gray-500">Included in Total collections · {dateFrom} → {dateTo}</p>
              </div>
              <button onClick={() => navigate(`/dashboard/products?dateFrom=${dateFrom}&dateTo=${dateTo}`)} className="w-full sm:w-auto text-sm px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">
                Manage products →
              </button>
            </div>
            {(!data.productMetrics || data.productMetrics.totalUnits === 0) ? (
              <p className="text-sm text-gray-400">No product sales in this range. Record one from the Products page.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-6">
                  <div>
                    <p className="text-2xl font-bold">₹{data.productMetrics.totalRevenue.toLocaleString('en-IN')}</p>
                    <p className="text-xs text-gray-500">Product revenue</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{data.productMetrics.totalUnits}</p>
                    <p className="text-xs text-gray-500">Units sold</p>
                  </div>
                </div>
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-800">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-gray-500">Product</th>
                        <th className="px-4 py-2 text-left font-medium text-gray-500">Units</th>
                        <th className="px-4 py-2 text-left font-medium text-gray-500">Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {(data.productMetrics.byProduct || []).map((p) => (
                        <tr key={p.id}>
                          <td className="px-4 py-2 font-medium">{p.name}</td>
                          <td className="px-4 py-2">{p.units}</td>
                          <td className="px-4 py-2">₹{p.revenue.toLocaleString('en-IN')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="md:hidden space-y-2">
                  {(data.productMetrics.byProduct || []).map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-2 text-sm">
                      <div>
                        <p className="font-medium">{p.name}</p>
                        <p className="text-xs text-gray-500">{p.units} units</p>
                      </div>
                      <p className="font-semibold shrink-0">₹{p.revenue.toLocaleString('en-IN')}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Kpi({ label, value, icon, hint, onClick, drillLabel }: {
  label: string
  value: string
  icon: string
  hint?: string
  onClick?: () => void
  drillLabel?: string
}) {
  const inner = (
    <>
      <p className="text-lg">{icon}</p>
      <p className="text-lg sm:text-xl font-bold mt-1 break-words">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
      {hint && <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{hint}</p>}
    </>
  )
  if (!onClick) {
    return <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-3 sm:p-4">{inner}</div>
  }
  return (
    <button onClick={onClick} type="button" title={drillLabel || `View details for ${label.toLowerCase()}`}
      className="text-left bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-3 sm:p-4 hover:border-primary/50 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-primary cursor-pointer">
      {inner}
      <p className="text-[10px] text-primary mt-0.5">{drillLabel || 'View bookings →'}</p>
    </button>
  )
}
