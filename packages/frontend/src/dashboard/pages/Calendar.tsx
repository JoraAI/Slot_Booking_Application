import React, { useState } from 'react'

export const CalendarPage: React.FC = () => {
  const [viewDate, setViewDate] = useState(new Date())
  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate()
  const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay()
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Calendar</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))} className="px-3 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">←</button>
          <span className="font-medium">{viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
          <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))} className="px-3 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">→</button>
        </div>
      </div>
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
        <div className="grid grid-cols-7 gap-1">
          {DAYS.map(d => <div key={d} className="text-center text-xs font-medium text-gray-500 py-2">{d}</div>)}
          {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1
            const isToday = new Date().toDateString() === new Date(viewDate.getFullYear(), viewDate.getMonth(), day).toDateString()
            return (
              <div key={day} className={`text-center py-3 rounded-lg text-sm cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 ${isToday ? 'bg-primary text-white hover:bg-primary-dark' : ''}`}>
                {day}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}