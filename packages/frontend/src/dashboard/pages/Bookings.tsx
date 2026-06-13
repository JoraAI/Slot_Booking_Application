import React, { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import type { Booking } from '../../types'

export const Bookings: React.FC = () => {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    api.getOwnerBookings(filter ? { status: filter } : undefined)
      .then((data) => setBookings(data.bookings))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [filter])

  const handleStatusChange = async (id: string, status: string) => {
    try {
      await api.updateOwnerBooking(id, { status })
      setBookings((prev) => prev.map((b) => b.id === id ? { ...b, status: status as any } : b))
    } catch {}
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Bookings</h1>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}
          className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800">
          <option value="">All Status</option>
          <option value="CONFIRMED">Confirmed</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="COMPLETED">Completed</option>
          <option value="NO_SHOW">No Show</option>
        </select>
      </div>
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Customer</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Time</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
            ) : bookings.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No bookings found</td></tr>
            ) : bookings.map((b) => (
              <tr key={b.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td className="px-4 py-3">
                  <p className="font-medium">{b.customerName}</p>
                  <p className="text-xs text-gray-400">{b.customerPhone}</p>
                </td>
                <td className="px-4 py-3">{b.date.split('T')[0]}</td>
                <td className="px-4 py-3">{b.startTime} - {b.endTime}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    b.status === 'CONFIRMED' ? 'bg-green-100 text-green-700' :
                    b.status === 'CANCELLED' ? 'bg-red-100 text-red-700' :
                    b.status === 'COMPLETED' ? 'bg-blue-100 text-blue-700' :
                    'bg-amber-100 text-amber-700'
                  }`}>{b.status}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    {b.status === 'CONFIRMED' && (
                      <>
                        <button onClick={() => handleStatusChange(b.id, 'COMPLETED')} className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200">Complete</button>
                        <button onClick={() => handleStatusChange(b.id, 'NO_SHOW')} className="text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded hover:bg-amber-200">No Show</button>
                        <button onClick={() => handleStatusChange(b.id, 'CANCELLED')} className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200">Cancel</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}