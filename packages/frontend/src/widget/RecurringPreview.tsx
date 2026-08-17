import React from 'react'
import { motion } from 'framer-motion'
import { localDateStr, parseLocalDate } from '../lib/localDate'

interface RecurringPreviewProps {
  frequency: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY'
  count: number
  startDate: string
  skipDates: string[]
  onSkipToggle: (date: string) => void
}

export const RecurringPreview: React.FC<RecurringPreviewProps> = ({
  frequency,
  count,
  startDate,
  skipDates,
  onSkipToggle,
}) => {
  const dates = generateRecurringDates(startDate, frequency, count)

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Upcoming Sessions</h4>
      <div className="max-h-48 overflow-y-auto space-y-1">
        {dates.map((date, i) => {
          const isSkipped = skipDates.includes(date)
          return (
            <motion.div
              key={date}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className={`flex items-center justify-between p-2 rounded-md text-sm ${
                isSkipped
                  ? 'bg-gray-100 dark:bg-gray-800 line-through text-gray-400'
                  : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700'
              }`}
            >
              <span>
                {parseLocalDate(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </span>
              <button
                type="button"
                onClick={() => onSkipToggle(date)}
                className={`text-xs px-2 py-0.5 rounded ${
                  isSkipped
                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                    : 'bg-red-100 text-red-700 hover:bg-red-200'
                }`}
              >
                {isSkipped ? 'Include' : 'Skip'}
              </button>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

function generateRecurringDates(startDate: string, frequency: string, count: number): string[] {
  const dates: string[] = []
  const start = parseLocalDate(startDate)
  const interval = frequency === 'WEEKLY' ? 7 : frequency === 'BIWEEKLY' ? 14 : 30

  for (let i = 0; i < count; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + interval * i)
    dates.push(localDateStr(d))
  }
  return dates
}