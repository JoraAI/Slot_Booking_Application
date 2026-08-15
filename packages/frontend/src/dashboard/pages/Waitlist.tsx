import React, { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import type { WaitlistEntry } from '../../types'
import toast from 'react-hot-toast'

export const WaitlistPage: React.FC = () => {
  const { config } = useStore()
  const [entries, setEntries] = useState<WaitlistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'waiting' | 'notified' | 'expired' | ''>('waiting')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.getWaitlist(filter ? { status: filter } : {})
      setEntries(res.entries)
    } catch (e: any) {
      setError(e.message || 'Failed to load waitlist')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { load() }, [load])

  const serviceName = (e: WaitlistEntry) => {
    if (e.serviceId && config) return config.services.find((s) => s.id === e.serviceId)?.name || 'Service'
    return 'Service'
  }
  const staffName = (e: WaitlistEntry) => {
    if (e.staffId && config) return config.staff.find((s) => s.id === e.staffId)?.name || null
    return null
  }

  const notify = async (e: WaitlistEntry) => {
    try {
      await api.notifyWaitlistEntry(e.id)
      toast.success('Customer notified')
      load()
    } catch (err: any) {
      toast.error(err.message || 'Failed to notify')
    }
  }

  const remove = async (e: WaitlistEntry) => {
    if (!window.confirm('Remove this waitlist entry?')) return
    try {
      await api.deleteWaitlistEntry(e.id)
      toast.success('Entry removed')
      load()
    } catch (err: any) {
      toast.error(err.message || 'Failed to remove')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Waitlist</h1>
        <select value={filter} onChange={(e) => setFilter(e.target.value as any)}
          className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800">
          <option value="waiting">Waiting</option>
          <option value="notified">Notified</option>
          <option value="expired">Expired</option>
          <option value="">All</option>
        </select>
      </div>

      {loading && <div className="skeleton h-40" />}

      {error && !loading && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-sm text-red-600">
          {error}
          <button onClick={load} className="ml-3 underline">Retry</button>
        </div>
      )}

      {!loading && !error && entries.length === 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
          <p className="text-3xl mb-2">⏳</p>
          <p className="text-gray-500">No waitlist entries for this view.</p>
        </div>
      )}

      {!loading && entries.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {entries.map((e) => (
              <div key={e.id} className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">{e.customerName}</p>
                  <p className="text-xs text-gray-400 truncate">
                    {serviceName(e)} · {e.date.slice(0, 10)} · {e.startTime}{staffName(e) ? ` · ${staffName(e)}` : ''}
                  </p>
                  <p className="text-xs text-gray-400 truncate">{e.customerPhone}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {!e.notified && !e.expired && (
                    <button onClick={() => notify(e)} className="px-3 py-1.5 text-xs bg-primary text-white rounded-md hover:bg-primary-dark">Notify</button>
                  )}
                  <button onClick={() => remove(e)} className="px-3 py-1.5 text-xs border border-red-200 text-red-600 rounded-md hover:bg-red-50">Remove</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
