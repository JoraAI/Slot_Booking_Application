import React from 'react'
import { motion } from 'framer-motion'
import type { Booking, LocationInfo } from '../../types'

interface ConfirmationScreenProps {
  booking: Booking
  businessName: string
  location?: LocationInfo | null
  depositPaid?: number | null
  remainder?: number
}

export const ConfirmationScreen: React.FC<ConfirmationScreenProps> = ({
  booking,
  businessName,
  location,
  depositPaid,
  remainder,
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="text-center space-y-6 py-8"
    >
      <motion.div
        className="w-20 h-20 mx-auto bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.2 }}
      >
        <motion.svg width="40" height="40" viewBox="0 0 40 40" className="text-green-500">
          <motion.path
            d="M10 20 L17 27 L30 13"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.6, ease: 'easeOut', delay: 0.4 }}
          />
        </motion.svg>
      </motion.div>

      <div>
        <h3 className="text-xl font-bold text-green-600">Booking Confirmed!</h3>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Your appointment at {businessName} is set.</p>
      </div>

      <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 text-left space-y-2 max-w-sm mx-auto">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Service</span>
          <span className="font-medium">{booking.serviceNameSnapshot || 'Appointment'}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Date</span>
          <span className="font-medium">
            {new Date(booking.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Time</span>
          <span className="font-medium">{booking.startTime} - {booking.endTime}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Name</span>
          <span className="font-medium">{booking.customerName}</span>
        </div>
        {depositPaid && remainder && (
          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
            <p className="text-sm text-green-600 font-medium">₹{depositPaid} paid</p>
            <p className="text-xs text-gray-500">Pay ₹{remainder} at the venue</p>
          </div>
        )}
        {booking.isRecurring && (
          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
            <p className="text-sm text-primary font-medium">🔄 Recurring booking</p>
          </div>
        )}
        {booking.finalPrice != null && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Amount</span>
            <span className="font-medium">₹{booking.finalPrice}</span>
          </div>
        )}
      </div>

      {booking.managementUrl && (
        <div className="max-w-sm mx-auto space-y-2">
          <p className="text-xs text-gray-500">Save this link to view or cancel your booking:</p>
          <div className="flex gap-2">
            <input
              readOnly
              value={booking.managementUrl}
              className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-xs bg-gray-50 dark:bg-gray-800"
            />
            <button
              onClick={() => { navigator.clipboard.writeText(booking.managementUrl || ''); }}
              className="px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg text-xs hover:bg-gray-200"
            >
              Copy
            </button>
          </div>
        </div>
      )}

      {location?.directionsUrl && (
        <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-4 text-left max-w-sm mx-auto space-y-1">
          <p className="text-sm font-medium">📍 {businessName}</p>
          {location.address && <p className="text-xs text-gray-600 dark:text-gray-400">{location.address}</p>}
          <a href={location.directionsUrl} target="_blank" rel="noopener noreferrer"
            className="inline-block text-sm text-indigo-600 dark:text-indigo-400 font-medium hover:underline">
            🗺️ Get directions
          </a>
        </div>
      )}

      <p className="text-xs text-gray-400">
        Booking Reference: {booking.id}<br />
        {booking.customerEmail || booking.customerPhone
          ? `Confirmation sent to ${booking.customerEmail || booking.customerPhone}`
          : 'Keep this reference if you need to view or cancel later.'}
      </p>
    </motion.div>
  )
}