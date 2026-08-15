import React from 'react'
import { motion } from 'framer-motion'
import type { AvailabilitySlot } from '../types'

interface TimeSlotGridProps {
  slots: AvailabilitySlot[]
  selectedTime: string | null
  onSelect: (time: string) => void
  showAvailableCount?: boolean
  loading: boolean
}

export const TimeSlotGrid: React.FC<TimeSlotGridProps> = ({
  slots,
  selectedTime,
  onSelect,
  showAvailableCount,
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
        <p className="text-sm">No available times for this day. Try another date.</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {slots.map((slot) => {
        const isSelected = selectedTime === slot.startTime
        return (
          <motion.button
            key={slot.startTime}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onSelect(slot.startTime)}
            className={`relative p-2 text-sm rounded-md border transition-all ${
              isSelected
                ? 'bg-primary text-white border-primary shadow-md'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-primary hover:bg-primary-light/50 cursor-pointer'
            }`}
          >
            <span className="font-medium">{slot.startTime}</span>
            {showAvailableCount && slot.availableCapacity > 0 && (
              <span className={`ml-1 text-xs ${isSelected ? 'text-white/80' : 'text-gray-400'}`}>
                ({slot.availableCapacity})
              </span>
            )}
          </motion.button>
        )
      })}
    </div>
  )
}
