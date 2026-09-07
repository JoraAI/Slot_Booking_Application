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

type CollectionFocus = 'all' | 'services' | 'products' | 'walkins'

const COLLECTION_FOCUSES: { value: CollectionFocus; label: string }[] = [
  { value: 'all', label: 'All collections' },
  { value: 'services', label: 'Services' },
  { value: 'products', label: 'Products' },
  { value: 'walkins', label: 'Walk-ins' },
]

const iso = (d: Date) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

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
  const [collectionFocus, setCollectionFocus] = useState<CollectionFocus>('all')

  const preset = rangeDays(range, upcomingDays)
  const dateFrom = customFrom || preset.dateFrom
  const dateTo = customTo || preset.dateTo

  const serviceCollected = data?.revenueMetrics?.totalCollected ?? 0
  const productCollected = data?.revenueMetrics?.productCollected ?? data?.productMetrics?.totalRevenue ?? 0
  const walkInCollected = data?.revenueMetrics?.invoiceCollected ?? 0
  const totalCollections = data?.revenueMetrics?.totalCollections
    ?? (serviceCollected + productCollected + walkInCollected)

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
            Bookings by appointment date · {dateFrom} to {dateTo}
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

          {/* Collections focus + KPIs */}
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Collections</h2>
              <div className="flex flex-wrap gap-1.5 rounded-xl bg-gray-100 dark:bg-gray-800/80 p-1">
                {COLLECTION_FOCUSES.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setCollectionFocus(f.value)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                      collectionFocus === f.value
                        ? 'bg-white dark:bg-gray-900 text-primary shadow-sm'
                        : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <Kpi
                label="Total collections"
                hint="Services + products + walk-ins"
                value={`₹${totalCollections.toLocaleString('en-IN')}`}
                icon="🏦"
                selected={collectionFocus === 'all'}
                onClick={() => setCollectionFocus('all')}
                drillLabel="Show all →"
              />
              <Kpi
                label="Service collections"
                hint="Paid bookings and cash booking invoices"
                value={`₹${serviceCollected.toLocaleString('en-IN')}`}
                icon="💰"
                selected={collectionFocus === 'services'}
                onClick={() => setCollectionFocus('services')}
                drillLabel="Focus services →"
              />
              <Kpi
                label="Product collections"
                hint="Retail sales in this range"
                value={`₹${productCollected.toLocaleString('en-IN')}`}
                icon="🛍️"
                selected={collectionFocus === 'products'}
                onClick={() => setCollectionFocus('products')}
                drillLabel="Focus products →"
              />
              <Kpi
                label="Walk-in invoices"
                hint="Walk-in / manual invoices issued in this range"
                value={`₹${walkInCollected.toLocaleString('en-IN')}`}
                icon="🧾"
                selected={collectionFocus === 'walkins'}
                onClick={() => setCollectionFocus('walkins')}
                drillLabel="Focus walk-ins →"
              />
            </div>

            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold">
                      {collectionFocus === 'all' && 'Collections breakdown'}
                      {collectionFocus === 'services' && 'Service collections'}
                      {collectionFocus === 'products' && 'Product collections'}
                      {collectionFocus === 'walkins' && 'Walk-in invoice collections'}
                    </h3>
                    <p className="text-xs text-gray-500 mt-0.5">{dateFrom} → {dateTo}</p>
                  </div>
                  {collectionFocus === 'services' && (
                    <button type="button" onClick={() => drillBookings()} className="text-xs text-primary hover:underline text-left">
                      View bookings →
                    </button>
                  )}
                  {collectionFocus === 'products' && (
                    <button type="button" onClick={() => navigate(`/dashboard/products?dateFrom=${dateFrom}&dateTo=${dateTo}`)} className="text-xs text-primary hover:underline text-left">
                      Manage products →
                    </button>
                  )}
                  {collectionFocus === 'walkins' && (
                    <button
                      type="button"
                      onClick={() => navigate(`/dashboard/invoices?dateFrom=${dateFrom}&dateTo=${dateTo}`)}
                      className="text-xs text-primary hover:underline text-left"
                    >
                      View invoices →
                    </button>
                  )}
                </div>

                {collectionFocus === 'all' && (
                  <div className="space-y-3">
                    <CollectionBar
                      parts={[
                        { label: 'Services', amount: serviceCollected, color: 'bg-primary' },
                        { label: 'Products', amount: productCollected, color: 'bg-emerald-500' },
                        { label: 'Walk-ins', amount: walkInCollected, color: 'bg-amber-500' },
                      ]}
                      total={totalCollections}
                    />
                    <div className="grid sm:grid-cols-3 gap-2 text-sm">
                      <BreakdownRow label="Services" amount={serviceCollected} total={totalCollections} onSelect={() => setCollectionFocus('services')} />
                      <BreakdownRow label="Products" amount={productCollected} total={totalCollections} onSelect={() => setCollectionFocus('products')} />
                      <BreakdownRow label="Walk-ins" amount={walkInCollected} total={totalCollections} onSelect={() => setCollectionFocus('walkins')} />
                    </div>
                  </div>
                )}

                {collectionFocus === 'services' && (
                  <div className="space-y-2">
                    <p className="text-2xl font-bold">₹{serviceCollected.toLocaleString('en-IN')}</p>
                    <p className="text-xs text-gray-500">From paid bookings and cash invoices linked to bookings.</p>
                    {(data.revenueByService || []).filter((s) => s.revenue > 0).length === 0 ? (
                      <p className="text-sm text-gray-400 pt-2">No service collections in this range.</p>
                    ) : (
                      <div className="space-y-1.5 pt-2">
                        {(data.revenueByService || []).filter((s) => s.revenue > 0).map((s) => (
                          <div key={s.name} className="flex items-center justify-between gap-3 text-sm px-2 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800/60">
                            <span className="break-words min-w-0">{s.name}</span>
                            <span className="font-medium shrink-0">₹{s.revenue.toLocaleString('en-IN')}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {collectionFocus === 'products' && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-6">
                      <div>
                        <p className="text-2xl font-bold">₹{productCollected.toLocaleString('en-IN')}</p>
                        <p className="text-xs text-gray-500">Product revenue</p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold">{data.productMetrics?.totalUnits ?? 0}</p>
                        <p className="text-xs text-gray-500">Units sold</p>
                      </div>
                    </div>
                    {(!data.productMetrics || data.productMetrics.totalUnits === 0) ? (
                      <p className="text-sm text-gray-400">No product sales in this range.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {(data.productMetrics.byProduct || []).map((p) => (
                          <div key={p.id} className="flex items-center justify-between gap-3 text-sm px-2 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800/60">
                            <div className="min-w-0">
                              <p className="font-medium break-words">{p.name}</p>
                              <p className="text-xs text-gray-500">{p.units} units</p>
                            </div>
                            <span className="font-medium shrink-0">₹{p.revenue.toLocaleString('en-IN')}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {collectionFocus === 'walkins' && (
                  <div className="space-y-2">
                    <p className="text-2xl font-bold">₹{walkInCollected.toLocaleString('en-IN')}</p>
                    <p className="text-xs text-gray-500">
                      Walk-in and manual invoices issued in this date range. Open Invoices for line-item detail.
                    </p>
                    {walkInCollected <= 0 && (
                      <p className="text-sm text-gray-400 pt-1">No walk-in invoices in this range.</p>
                    )}
                  </div>
                )}
              </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <Kpi label="QR Bookings" value={`${data.qrBooking?.count ?? 0} (${data.qrBooking?.rate ?? 0}%)`} icon="🔳" onClick={() => drillBookings({ source: 'QR' })} hint="QR-sourced bookings" />
            <Kpi label="Avg Booking Value" value={`₹${(data.avgBookingValue ?? data.revenueMetrics?.avgBookingValue ?? 0).toLocaleString('en-IN')}`} icon="🧾" hint="Among paid / invoiced bookings" />
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

          {/* Services & sources — always useful for booking ops; revenue column is service collections */}
          {(collectionFocus === 'all' || collectionFocus === 'services') && (
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
          )}

          {/* Product sales — shown for All; Products focus already has a compact list above */}
          {(collectionFocus === 'all') && (
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
          )}
        </>
      )}
    </div>
  )
}

function CollectionBar({ parts, total }: {
  parts: { label: string; amount: number; color: string }[]
  total: number
}) {
  if (total <= 0) {
    return <p className="text-sm text-gray-400">No collections in this range yet.</p>
  }
  const visible = parts.filter((p) => p.amount > 0)
  return (
    <div className="space-y-2">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
        {visible.map((p) => (
          <div
            key={p.label}
            className={`${p.color} h-full min-w-0`}
            style={{ width: `${(p.amount / total) * 100}%` }}
            title={`${p.label}: ₹${p.amount.toLocaleString('en-IN')}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-[11px] text-gray-500">
        {parts.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${p.color}`} />
            {p.label}
            <span className="text-gray-400">₹{p.amount.toLocaleString('en-IN')}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function BreakdownRow({ label, amount, total, onSelect }: {
  label: string
  amount: number
  total: number
  onSelect: () => void
}) {
  const pct = total > 0 ? Math.round((amount / total) * 100) : 0
  return (
    <button
      type="button"
      onClick={onSelect}
      className="text-left rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2 hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary"
    >
      <p className="text-xs text-gray-500">{label}</p>
      <p className="font-semibold">₹{amount.toLocaleString('en-IN')}</p>
      <p className="text-[11px] text-gray-400">{pct}% of total</p>
    </button>
  )
}

function Kpi({ label, value, icon, hint, onClick, drillLabel, selected }: {
  label: string
  value: string
  icon: string
  hint?: string
  onClick?: () => void
  drillLabel?: string
  selected?: boolean
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
    <button
      onClick={onClick}
      type="button"
      title={drillLabel || `View details for ${label.toLowerCase()}`}
      className={`text-left rounded-xl border p-3 sm:p-4 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-primary cursor-pointer transition ${
        selected
          ? 'bg-primary/5 border-primary shadow-sm'
          : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 hover:border-primary/50'
      }`}
    >
      {inner}
      <p className="text-[10px] text-primary mt-0.5">{drillLabel || 'View bookings →'}</p>
    </button>
  )
}
