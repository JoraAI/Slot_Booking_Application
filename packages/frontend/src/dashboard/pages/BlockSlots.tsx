import React, { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import type { BlockedSlot } from '../../types'

function blockDateStr(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toISOString().slice(0, 10)
}

function formatDisplayDate(value: string): string {
  const ymd = blockDateStr(value)
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ymd
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export const BlockSlots: React.FC = () => {
  const { config } = useStore()
  const staffList = (config?.staff || []).filter((s) => s.isActive)
  const showStaff = !!config?.enableMultiStaff && staffList.length > 0

  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('17:00')
  const [reason, setReason] = useState('')
  const [staffId, setStaffId] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  const [blocks, setBlocks] = useState<BlockedSlot[]>([])
  const [loading, setLoading] = useState(false)
  const [listLoading, setListLoading] = useState(true)

  const loadBlocks = useCallback(async () => {
    setListLoading(true)
    try {
      const rows = await api.getBlockedSlots()
      setBlocks(rows)
    } catch (err: any) {
      toast.error(err.message || 'Failed to load blocked slots')
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    loadBlocks()
  }, [loadBlocks])

  const resetForm = () => {
    setEditingId(null)
    setDate('')
    setStartTime('09:00')
    setEndTime('17:00')
    setReason('')
    setStaffId('')
  }

  const payload = () => ({
    date,
    startTime,
    endTime,
    reason: reason.trim() || null,
    staffId: staffId || null,
  })

  const handleSave = async () => {
    if (!date) return toast.error('Select a date')
    if (endTime <= startTime) return toast.error('End time must be after start time')
    setLoading(true)
    try {
      if (editingId) {
        await api.updateBlockedSlot(editingId, payload())
        toast.success('Blocked slot updated')
      } else {
        await api.createBlock(payload())
        toast.success('Slot blocked')
      }
      resetForm()
      await loadBlocks()
    } catch (err: any) {
      toast.error(err.message || 'Failed')
    } finally {
      setLoading(false)
    }
  }

  const startEdit = (block: BlockedSlot) => {
    setEditingId(block.id)
    setDate(blockDateStr(block.date))
    setStartTime(block.startTime)
    setEndTime(block.endTime)
    setReason(block.reason || '')
    setStaffId(block.staffId || '')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleUnblock = async (block: BlockedSlot) => {
    if (!window.confirm(`Remove the block on ${formatDisplayDate(block.date)} ${block.startTime}–${block.endTime}?`)) return
    try {
      await api.unblockSlot(block.id)
      toast.success('Block removed')
      if (editingId === block.id) resetForm()
      await loadBlocks()
    } catch (err: any) {
      toast.error(err.message || 'Failed to remove block')
    }
  }

  const today = useMemo(() => {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }, [])

  const upcoming = blocks.filter((b) => blockDateStr(b.date) >= today)
  const past = blocks.filter((b) => blockDateStr(b.date) < today)

  const renderList = (items: BlockedSlot[]) => (
    <div className="divide-y divide-gray-100 dark:divide-gray-800">
      {items.map((block) => (
        <div key={block.id} className="py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium text-sm">
              {formatDisplayDate(block.date)}
              <span className="text-gray-500 font-normal"> · {block.startTime}–{block.endTime}</span>
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {block.staff?.name || (block.staffId ? 'Staff' : 'All staff')}
              {block.reason ? ` · ${block.reason}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => startEdit(block)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => handleUnblock(block)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              Unblock
            </button>
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold">Block Slots</h1>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{editingId ? 'Update blocked slot' : 'Block a time range'}</h2>
          {editingId && (
            <button type="button" onClick={resetForm} className="text-sm text-gray-500 hover:text-gray-800">
              Cancel edit
            </button>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Start Time</label>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">End Time</label>
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
          </div>
        </div>
        {showStaff && (
          <div>
            <label className="block text-sm font-medium mb-1">Staff (optional)</label>
            <select
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800"
            >
              <option value="">All staff</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-sm font-medium mb-1">Reason (optional)</label>
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Holiday, Maintenance..."
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800" />
        </div>
        <button onClick={handleSave} disabled={loading}
          className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 disabled:opacity-50">
          {loading ? (editingId ? 'Updating...' : 'Blocking...') : (editingId ? 'Update Block' : 'Block Slot')}
        </button>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Blocked history</h2>
          <button
            type="button"
            onClick={loadBlocks}
            disabled={listLoading}
            className="text-sm text-gray-500 hover:text-gray-800 disabled:opacity-50"
          >
            {listLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {listLoading && blocks.length === 0 && (
          <p className="text-sm text-gray-500">Loading blocked slots...</p>
        )}

        {!listLoading && blocks.length === 0 && (
          <p className="text-sm text-gray-500">No blocked slots yet. Blocks you create will appear here.</p>
        )}

        {upcoming.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Upcoming</p>
            {renderList(upcoming)}
          </div>
        )}

        {past.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Past</p>
            {renderList(past)}
          </div>
        )}
      </div>
    </div>
  )
}
