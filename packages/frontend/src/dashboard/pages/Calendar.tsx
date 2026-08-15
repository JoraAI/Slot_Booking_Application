import React, { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import type { Booking } from '../../types'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const CalendarPage: React.FC = () => {
  const [viewDate, setViewDate] = useState(new Date())
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState<string>(iso(new Date()))

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1)
    const last = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0)
    try {
      const res = await api.getOwnerBookings({ dateFrom: iso(first), dateTo: iso(last), limit: '500' })
      // Cancelled appointments no longer occupy the operational calendar.
      setBookings(res.bookings.filter((booking) => booking.status !== 'CANCELLED'))
    } catch (e: any) {
      setError(e.message || 'Failed to load bookings')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [viewDate])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const refresh = () => { void load(true) }
    const interval = window.setInterval(refresh, 15000)
    window.addEventListener('focus', refresh)

    const channel = 'BroadcastChannel' in window ? new BroadcastChannel('slotbook-bookings') : null
    if (channel) channel.onmessage = refresh

    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
      channel?.close()
    }
  }, [load])

  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate()
  const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay()
  const byDay: Record<string, Booking[]> = {}
  bookings.forEach((b) => {
    const d = b.date.slice(0, 10)
    if (!byDay[d]) byDay[d] = []
    byDay[d].push(b)
  })
  const selectedList = byDay[selectedDay] || []

  const month = viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Calendar</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))} className="px-3 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">←</button>
          <span className="font-medium">{month}</span>
          <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))} className="px-3 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">→</button>
        </div>
      </div>

      {error && !loading && <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-sm text-red-600">{error}</div>}

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
        <div className="grid grid-cols-7 gap-1">
          {DAYS.map((d) => <div key={d} className="text-center text-xs font-medium text-gray-500 py-2">{d}</div>)}
          {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1
            const dateStr = iso(new Date(viewDate.getFullYear(), viewDate.getMonth(), day))
            const dayBookings = byDay[dateStr] || []
            const isToday = iso(new Date()) === dateStr
            const selected = selectedDay === dateStr
            return (
              <button
                key={day}
                onClick={() => setSelectedDay(dateStr)}
                className={`text-center py-2 rounded-lg text-sm transition-colors ${selected ? 'bg-primary text-white' : isToday ? 'bg-primary-light dark:bg-primary/20 font-medium' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
              >
                <span className={selected ? '' : 'text-gray-700 dark:text-gray-300'}>{day}</span>
                {dayBookings.length > 0 && (
                  <span className={`block text-[10px] mt-0.5 ${selected ? 'text-white/80' : 'text-primary'}`}>{dayBookings.length}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Selected-day list (mobile-friendly cards) */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
        <h2 className="font-semibold mb-3">
          {new Date(selectedDay).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          <span className="ml-2 text-sm font-normal text-gray-400">{selectedList.length} booking{selectedList.length === 1 ? '' : 's'}</span>
        </h2>
        {loading && <div className="skeleton h-16" />}
        {!loading && selectedList.length === 0 && <p className="text-sm text-gray-400">No bookings this day.</p>}
        <div className="space-y-2">
          {selectedList
            .slice()
            .sort((a, b) => a.startTime.localeCompare(b.startTime))
            .map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-3 border border-gray-100 dark:border-gray-800 rounded-lg p-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">{b.serviceNameSnapshot || 'Appointment'}</p>
                  <p className="text-xs text-gray-400 truncate">
                    {b.customerName}{b.staff?.name ? ` · ${b.staff.name}` : ''}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-medium">{b.startTime} - {b.endTime}</p>
                  <p className="text-xs text-gray-400">{b.status}</p>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
