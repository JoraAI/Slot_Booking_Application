import React, { useState } from 'react'
import { FeatureGate } from '../../widget/FeatureGate'

export const Analytics: React.FC = () => {
  const [range, setRange] = useState('30d')
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const HOURS = Array.from({length: 24}, (_, i) => i)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Analytics</h1>
        <select value={range} onChange={(e) => setRange(e.target.value)}
          className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800">
          <option value="today">Today</option>
          <option value="7d">This Week</option>
          <option value="30d">Last 30 Days</option>
        </select>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Bookings', value: '0', icon: '📋' },
          { label: 'Cancellation Rate', value: '0%', icon: '📉' },
          { label: 'Peak Hour', value: '--', icon: '🕐' },
          { label: 'Busiest Day', value: '--', icon: '📅' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
            <p className="text-lg">{kpi.icon}</p>
            <p className="text-2xl font-bold mt-2">{kpi.value}</p>
            <p className="text-xs text-gray-500">{kpi.label}</p>
          </div>
        ))}
      </div>

      {/* Heatmap */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
        <h2 className="text-lg font-semibold mb-4">Booking Heatmap</h2>
        <div className="overflow-x-auto">
          <div className="grid gap-1" style={{ gridTemplateColumns: `60px repeat(24, 1fr)` }}>
            <div />
            {HOURS.map(h => <div key={h} className="text-[10px] text-gray-400 text-center">{h}</div>)}
            {DAYS.map(day => (
              <React.Fragment key={day}>
                <div className="text-xs text-gray-500 flex items-center">{day}</div>
                {HOURS.map(h => (
                  <div key={`${day}-${h}`} className="aspect-square rounded-sm bg-gray-100 dark:bg-gray-800" title={`${day} ${h}:00 — 0 bookings`} />
                ))}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* Status Breakdown */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
        <h2 className="text-lg font-semibold mb-4">Booking Status Breakdown</h2>
        <div className="flex items-center gap-6 justify-center py-4">
          {[
            { label: 'Confirmed', color: '#7C3AED', count: 0 },
            { label: 'Completed', color: '#10B981', count: 0 },
            { label: 'Cancelled', color: '#EF4444', count: 0 },
            { label: 'No-Show', color: '#F59E0B', count: 0 },
          ].map(s => (
            <div key={s.label} className="text-center">
              <div className="w-4 h-4 rounded-full mx-auto mb-1" style={{ backgroundColor: s.color }} />
              <p className="text-sm font-medium">{s.count}</p>
              <p className="text-xs text-gray-500">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      <FeatureGate feature="payments">
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="text-lg font-semibold mb-4">Revenue</h2>
          <p className="text-gray-500 text-sm">Revenue data will appear here when payments are enabled.</p>
        </div>
      </FeatureGate>
    </div>
  )
}