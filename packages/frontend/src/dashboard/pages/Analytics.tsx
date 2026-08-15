import React, { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import type { AnalyticsData } from '../../types'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function rangeDays(range: string): { dateFrom: string; dateTo: string } {
  const to = new Date()
  const from = new Date(to)
  if (range === '7d') from.setDate(from.getDate() - 7)
  else if (range === '30d') from.setDate(from.getDate() - 30)
  else from.setDate(from.getDate() - 1) // today
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { dateFrom: iso(from), dateTo: iso(to) }
}

export const Analytics: React.FC = () => {
  const [range, setRange] = useState('30d')
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = rangeDays(range)
      setData(await api.getAnalytics({ ...r, ...(range === 'today' ? {} : {}) }))
    } catch (e: any) {
      setError(e.message || 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => { load() }, [load])

  const maxHeat = data ? Math.max(1, ...Object.values(data.heatmap).flatMap((d) => Object.values(d))) : 1
  const maxTrend = data && data.sparkline?.length ? Math.max(1, ...data.sparkline) : 1

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Analytics</h1>
        <select value={range} onChange={(e) => setRange(e.target.value)}
          className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800">
          <option value="today">Today</option>
          <option value="7d">Last 7 Days</option>
          <option value="30d">Last 30 Days</option>
        </select>
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
            <Kpi label="Total Bookings" value={String(data.totalBookings ?? 0)} icon="📋" />
            <Kpi label="Cancellation Rate" value={`${data.cancellationRate ?? 0}%`} icon="📉" />
            <Kpi label="Peak Hour" value={data.peakHour || '--'} icon="🕐" />
            <Kpi label="Busiest Day" value={data.busiestDay || '--'} icon="📅" />
          </div>

          {/* Revenue row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi label="Collected" value={`₹${(data.revenueMetrics?.totalCollected ?? 0).toLocaleString('en-IN')}`} icon="💰" />
            <Kpi label="Avg Booking Value" value={`₹${(data.avgBookingValue ?? 0).toLocaleString('en-IN')}`} icon="🧾" />
            <Kpi label="Discounts Given" value={`₹${(data.revenueMetrics?.discountsGiven ?? 0).toLocaleString('en-IN')}`} icon="🏷️" />
            <Kpi label="QR Bookings" value={`${data.qrBooking?.count ?? 0} (${data.qrBooking?.rate ?? 0}%)`} icon="🔳" />
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
              <h2 className="text-lg font-semibold mb-4">Bookings (last 7 days)</h2>
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
                    <span className="w-24 capitalize">{k}</span>
                    <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-2">
                      <div className="bg-primary rounded-full h-2" style={{ width: `${data.totalBookings ? (v / data.totalBookings) * 100 : 0}%` }} />
                    </div>
                    <span className="w-10 text-right">{v}</span>
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
                  <div key={s.name} className="flex items-center justify-between text-sm">
                    <span>{s.name}</span>
                    <span className="text-gray-500">{s.count} · ₹{s.revenue.toLocaleString('en-IN')}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
              <h2 className="text-lg font-semibold mb-4">By Source</h2>
              {(data.bookingsBySource || []).length === 0 && <p className="text-sm text-gray-400">No bookings in this range.</p>}
              <div className="space-y-2">
                {(data.bookingsBySource || []).map((s) => (
                  <div key={s.source} className="flex items-center justify-between text-sm">
                    <span>{s.source}</span>
                    <span className="text-gray-500">{s.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Kpi({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
      <p className="text-lg">{icon}</p>
      <p className="text-xl font-bold mt-1 truncate">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  )
}
