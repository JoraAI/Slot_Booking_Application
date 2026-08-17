import React, { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { localDateStr, startOfTodayInTimeZone } from '../lib/localDate'

interface CalendarPickerProps {
  bookingWindowDays: number
  timezone: string
  selectedDate: string | null
  onSelect: (date: string) => void
  workingHours: { dayOfWeek: number; isOpen: boolean }[]
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export const CalendarPicker: React.FC<CalendarPickerProps> = ({
  bookingWindowDays,
  timezone,
  selectedDate,
  onSelect,
  workingHours,
}) => {
  const today = startOfTodayInTimeZone(timezone || 'Asia/Kolkata')
  const [viewMonth, setViewMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const maxDate = new Date(today)
  maxDate.setDate(maxDate.getDate() + bookingWindowDays)

  const openDays = useMemo(() => {
    const set = new Set<number>()
    workingHours.forEach((wh) => {
      if (wh.isOpen) set.add(wh.dayOfWeek)
    })
    return set
  }, [workingHours])

  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate()
  const firstDayOfWeek = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1).getDay()

  const calendarDays = useMemo(() => {
    const days: (Date | null)[] = []
    for (let i = 0; i < firstDayOfWeek; i++) days.push(null)
    for (let d = 1; d <= daysInMonth; d++) {
      days.push(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), d))
    }
    return days
  }, [viewMonth, daysInMonth, firstDayOfWeek])

  const isDateEnabled = (date: Date) => {
    if (date < today) return false
    if (date > maxDate) return false
    return openDays.has(date.getDay())
  }

  const dateStr = (date: Date) => localDateStr(date)

  const prevMonth = () => {
    setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))
  }
  const nextMonth = () => {
    setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button onClick={prevMonth} className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-sm">
          ←
        </button>
        <span className="font-semibold text-sm">
          {MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
        </span>
        <button onClick={nextMonth} className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-sm">
          →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {DAYS.map((d) => (
          <div key={d} className="text-xs font-medium text-gray-500 py-1">
            {d}
          </div>
        ))}
        {calendarDays.map((date, i) => {
          if (!date) return <div key={`empty-${i}`} />
          const enabled = isDateEnabled(date)
          const selected = selectedDate === dateStr(date)
          return (
            <motion.button
              key={dateStr(date)}
              whileTap={enabled ? { scale: 0.9 } : {}}
              onClick={() => enabled && onSelect(dateStr(date))}
              disabled={!enabled}
              className={`p-2 text-sm rounded-md transition-colors ${
                selected
                  ? 'bg-primary text-white font-semibold'
                  : enabled
                  ? 'hover:bg-primary-light dark:hover:bg-gray-800 cursor-pointer'
                  : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
              }`}
            >
              {date.getDate()}
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}