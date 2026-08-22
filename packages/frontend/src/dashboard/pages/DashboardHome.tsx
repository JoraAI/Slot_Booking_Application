import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { useCountUp } from '../../hooks'
import { FeatureGate } from '../../widget/FeatureGate'
import type { Booking } from '../../types'

export const DashboardHome: React.FC = () => {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [waAlert, setWaAlert] = useState<{
    needConnect: boolean
    lowBalance: boolean
    balancePaise: number
  } | null>(null)

  useEffect(() => {
    api.getOwnerBookings({ status: 'CONFIRMED' })
      .then((data) => setBookings(data.bookings))
      .catch(() => {})
      .finally(() => setLoading(false))

    Promise.all([api.getOwnerSettingsStatus(), api.getWhatsappStatus().catch(() => null)])
      .then(([status, wa]) => {
        const needConnect = status.metaWhatsappConfigured && !status.whatsappConnected
        const platformDown = !status.metaWhatsappConfigured
        const lowBalance = !!(status.walletLowBalance || wa?.wallet?.lowBalance)
        setWaAlert({
          needConnect: needConnect || platformDown,
          lowBalance: !needConnect && !platformDown && lowBalance,
          balancePaise: status.walletBalancePaise ?? wa?.wallet?.balancePaise ?? 0,
        })
      })
      .catch(() => {})
  }, [])

  const todayCount = bookings.filter(b => {
    const d = new Date(b.date).toDateString()
    return d === new Date().toDateString()
  }).length

  const totalCount = bookings.length

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {waAlert?.needConnect && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 p-4 text-sm text-amber-900 dark:text-amber-100">
          <p className="font-medium">Enable WhatsApp for booking alerts</p>
          <p className="mt-1 text-amber-800/90 dark:text-amber-200/90">
            WhatsApp messages are sent from Reservly’s shared number. Enable WhatsApp in Settings, add wallet credits,
            then turn on customer WhatsApp notifications. Email still works without WhatsApp.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/dashboard/settings" className="px-3 py-2 rounded-lg bg-primary text-white text-xs font-medium">
              Open Settings
            </Link>
            <Link to="/dashboard/notifications" className="px-3 py-2 rounded-lg border border-amber-400 text-xs font-medium">
              Add credits
            </Link>
          </div>
        </div>
      )}

      {waAlert && !waAlert.needConnect && waAlert.lowBalance && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 p-4 text-sm text-amber-900 dark:text-amber-100">
          <p className="font-medium">WhatsApp credits are running low (₹{(waAlert.balancePaise / 100).toFixed(2)})</p>
          <p className="mt-1">Top up so confirmations and reminders keep sending.</p>
          <Link to="/dashboard/notifications" className="inline-block mt-2 text-primary font-medium text-xs underline">
            Add credits →
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Today's Bookings" value={todayCount} color="bg-primary" />
        <KPICard title="Total Active" value={totalCount} color="bg-blue-500" />
        <FeatureGate feature="payments">
          <KPICard title="Revenue Today" value={0} prefix="₹" color="bg-green-500" />
        </FeatureGate>
        <FeatureGate feature="waitlist">
          <KPICard title="Waitlist Queue" value={0} color="bg-amber-500" />
        </FeatureGate>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
        <h2 className="text-lg font-semibold mb-4">Recent Bookings</h2>
        {loading ? (
          <div className="space-y-3">{Array.from({length: 3}).map((_, i) => <div key={i} className="skeleton h-12" />)}</div>
        ) : bookings.length === 0 ? (
          <p className="text-gray-500 text-sm">No bookings yet</p>
        ) : (
          <div className="space-y-2">
            {bookings.slice(0, 5).map((b) => (
              <div key={b.id} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
                <div>
                  <p className="font-medium text-sm">{b.customerName}</p>
                  <p className="text-xs text-gray-500">
                    {b.serviceNameSnapshot || b.service?.name || 'Appointment'}
                    {' · '}
                    {b.date.split('T')[0]} at {b.startTime}
                  </p>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  b.status === 'CONFIRMED' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                }`}>{b.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function KPICard({ title, value, color, prefix = '' }: { title: string; value: number; color: string; prefix?: string }) {
  const count = useCountUp(value, 800)
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 ${color} rounded-lg flex items-center justify-center text-white text-lg font-bold`}>
          {prefix || count.toString()[0] || '0'}
        </div>
        <div>
          <p className="text-2xl font-bold">{prefix}{count}</p>
          <p className="text-xs text-gray-500">{title}</p>
        </div>
      </div>
    </div>
  )
}
