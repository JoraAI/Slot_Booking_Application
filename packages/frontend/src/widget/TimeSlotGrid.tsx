import React from 'react'
import { motion } from 'framer-motion'
import type { TimeSlot } from '../types'

interface TimeSlotGridProps {
  slots: TimeSlot[]
  selectedTime: string | null
  onSelect: (time: string) => void
  onWaitlist?: (time: string) => void
  showAvailableCount: boolean
  parallelSeats: number
  loading: boolean
}

export const TimeSlotGrid: React.FC<TimeSlotGridProps> = ({
  slots,
  selectedTime,
  onSelect,
  onWaitlist,
  showAvailableCount,
  parallelSeats,
  loading,
}) => {
  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="skeleton h-10 rounded-md" />
        ))}
      </div>
    )
  }

  if (slots.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        <p className="text-sm">Select a date to see available time slots</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {slots.map((slot) => {
        const isSelected = selectedTime === slot.time
        const isFull = !slot.isAvailable && !slot.isBlocked
        const showWaitlist = isFull && onWaitlist

        return (
          <motion.button
            key={slot.time}
            whileHover={slot.isAvailable ? { y: -2 } : {}}
            whileTap={slot.isAvailable ? { scale: 0.95 } : {}}
            onClick={() => {
              if (slot.isAvailable) onSelect(slot.time)
              else if (showWaitlist) onWaitlist(slot.time)
            }}
            className={`relative p-2 text-sm rounded-md border transition-all ${
              isSelected
                ? 'bg-primary text-white border-primary shadow-md'
                : slot.isBlocked
                ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 line-through cursor-not-allowed border-gray-200 dark:border-gray-700'
                : isFull && !showWaitlist
                ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed border-gray-200 dark:border-gray-700'
                : showWaitlist
                ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700 cursor-pointer hover:bg-amber-100'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-primary hover:bg-primary-light/50 cursor-pointer'
            }`}
          >
            <span className="font-medium">{slot.time}</span>
            {showAvailableCount && slot.isAvailable && slot.availableSeats !== undefined && (
              <span className={`ml-1 text-xs ${isSelected ? 'text-white/80' : 'text-gray-400'}`}>
                ({slot.availableSeats}/{parallelSeats})
              </span>
            )}
            {showWaitlist && (
              <motion.span
                className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400"
                animate={{ opacity: [1, 0.4, 1] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
              />
            )}
          </motion.button>
        )
      })}
    </div>
  )
}