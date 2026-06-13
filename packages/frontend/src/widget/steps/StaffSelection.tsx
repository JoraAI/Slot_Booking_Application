import React from 'react'
import { motion } from 'framer-motion'
import type { Staff } from '../../types'

interface StaffSelectionProps {
  staff: Staff[]
  selectedStaff: string | null
  onSelect: (id: string | null) => void
}

export const StaffSelection: React.FC<StaffSelectionProps> = ({ staff, selectedStaff, onSelect }) => {
  const activeStaff = staff.filter((s) => s.isActive)

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Choose Your Preferred Staff</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {/* Any Available card */}
        <motion.button
          layoutId="staff-any"
          onClick={() => onSelect(null)}
          whileTap={{ scale: 0.95 }}
          className={`relative p-4 rounded-xl border-2 text-center transition-all ${
            selectedStaff === null
              ? 'border-primary bg-primary-light/50 shadow-md'
              : 'border-gray-200 dark:border-gray-700 hover:border-primary/50'
          }`}
        >
          <div className="w-12 h-12 mx-auto rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-lg font-bold text-gray-500">
            🔀
          </div>
          <p className="mt-2 font-medium text-sm">Any Available</p>
          <p className="text-xs text-gray-500">No preference</p>
          {selectedStaff === null && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -top-2 -right-2 w-6 h-6 bg-primary text-white rounded-full flex items-center justify-center text-xs"
            >
              ✓
            </motion.div>
          )}
        </motion.button>

        {activeStaff.map((s) => (
          <motion.button
            key={s.id}
            layoutId={`staff-${s.id}`}
            onClick={() => onSelect(s.id)}
            whileTap={{ scale: 0.95 }}
            className={`relative p-4 rounded-xl border-2 text-center transition-all ${
              selectedStaff === s.id
                ? 'border-primary bg-primary-light/50 shadow-md'
                : 'border-gray-200 dark:border-gray-700 hover:border-primary/50'
            }`}
          >
            <div
              className="w-12 h-12 mx-auto rounded-full flex items-center justify-center text-lg font-bold text-white"
              style={{ backgroundColor: s.color }}
            >
              {s.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
            </div>
            <p className="mt-2 font-medium text-sm">{s.name}</p>
            {s.role && <p className="text-xs text-gray-500">{s.role}</p>}
            {selectedStaff === s.id && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute -top-2 -right-2 w-6 h-6 bg-primary text-white rounded-full flex items-center justify-center text-xs"
              >
                ✓
              </motion.div>
            )}
          </motion.button>
        ))}
      </div>
    </div>
  )
}