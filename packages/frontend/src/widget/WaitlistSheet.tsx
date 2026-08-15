import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../lib/api'
import toast from 'react-hot-toast'

interface WaitlistSheetProps {
  slug: string
  slotTime: string
  slotDate: string
  onClose: () => void
  staffId?: string | null
  serviceId?: string | null
}

export const WaitlistSheet: React.FC<WaitlistSheetProps> = ({ slug, slotTime, slotDate, onClose, staffId, serviceId }) => {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [joined, setJoined] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await api.joinWaitlist(slug, {
        date: slotDate,
        startTime: slotTime,
        customerName: name,
        customerPhone: phone,
        customerEmail: email || undefined,
        staffId: staffId || undefined,
        serviceId: serviceId || undefined,
      })
      setJoined(true)
      toast.success('Added to waitlist!')
    } catch (err: any) {
      toast.error(err.message || 'Failed to join waitlist')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="fixed inset-x-0 bottom-0 bg-white dark:bg-gray-900 rounded-t-xl shadow-xl p-6 z-50 border-t border-gray-200 dark:border-gray-700"
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">✕</button>
        {!joined ? (
          <>
            <h3 className="text-lg font-semibold mb-1">Join Waitlist</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              This slot is full. We'll notify you if a spot opens up.
            </p>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Full Name"
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
              <input required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone Number" type="tel"
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" type="email"
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
              <button type="submit" disabled={submitting}
                className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-md font-medium text-sm disabled:opacity-50">
                {submitting ? 'Joining...' : 'Join Waitlist'}
              </button>
            </form>
          </>
        ) : (
          <div className="text-center py-4">
            <div className="text-3xl mb-2">🎉</div>
            <h3 className="text-lg font-semibold">You're on the waitlist!</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              We'll notify you if a slot opens up for {slotTime}.
            </p>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  )
}