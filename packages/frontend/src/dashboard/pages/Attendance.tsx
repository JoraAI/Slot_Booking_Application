import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import type {
  AttendanceStatus,
  AttendanceStaffSummary,
} from '../../types'

const STATUSES: { value: AttendanceStatus; label: string; short: string; className: string; filled: string }[] = [
  { value: 'PRESENT', label: 'Present', short: 'P', className: 'bg-emerald-100 text-emerald-800 border-emerald-200', filled: 'bg-emerald-500 text-white border-emerald-600' },
  { value: 'HALF_DAY', label: 'Half-day', short: 'H', className: 'bg-amber-100 text-amber-900 border-amber-200', filled: 'bg-amber-500 text-white border-amber-600' },
  { value: 'ABSENT', label: 'Absent', short: 'A', className: 'bg-red-100 text-red-800 border-red-200', filled: 'bg-red-500 text-white border-red-600' },
  { value: 'LEAVE', label: 'Leave', short: 'L', className: 'bg-blue-100 text-blue-800 border-blue-200', filled: 'bg-blue-500 text-white border-blue-600' },
]

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function weekdayIndex(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

function monthBounds(month: string): { from: string; to: string; days: string[] } {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const days: string[] = []
  for (let d = 1; d <= last; d++) {
    days.push(`${y}-${pad2(m)}-${pad2(d)}`)
  }
  return { from: days[0], to: days[days.length - 1], days }
}

function currentMonthStr(tz?: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(new Date())
    const y = parts.find((p) => p.type === 'year')?.value
    const mo = parts.find((p) => p.type === 'month')?.value
    if (y && mo) return `${y}-${mo}`
  } catch { /* fall through */ }
  const now = new Date()
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`
}

function todayStr(tz?: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
  } catch {
    const n = new Date()
    return `${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())}`
  }
}

function statusMeta(status: AttendanceStatus | null | undefined) {
  return STATUSES.find((s) => s.value === status) || null
}

function inr(n: number | null | undefined) {
  if (n == null) return '—'
  return `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

export const AttendancePage: React.FC = () => {
  const { config } = useStore()
  const [month, setMonth] = useState(() => currentMonthStr(config?.timezone))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [openWeekdays, setOpenWeekdays] = useState<number[]>([1, 2, 3, 4, 5, 6])
  const [staff, setStaff] = useState<AttendanceListResponseStaff[]>([])
  const [map, setMap] = useState<Record<string, AttendanceStatus>>({})
  const [summary, setSummary] = useState<AttendanceStaffSummary[]>([])
  const [workingDays, setWorkingDays] = useState(0)
  const [picker, setPicker] = useState<{ staffId: string; date: string; name: string } | null>(null)
  const [expandedStaff, setExpandedStaff] = useState<string | null>(null)

  const { from, to, days } = useMemo(() => monthBounds(month), [month])
  const today = useMemo(() => todayStr(config?.timezone), [config?.timezone])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, sum] = await Promise.all([
        api.getAttendance(from, to),
        api.getAttendanceSummary(month),
      ])
      setStaff(list.staff)
      setOpenWeekdays(list.openWeekdays)
      setWorkingDays(sum.workingDaysInMonth)
      setSummary(sum.staff)
      const next: Record<string, AttendanceStatus> = {}
      for (const row of list.attendances) {
        if (row.status) next[`${row.staffId}|${row.date}`] = row.status
      }
      setMap(next)
      if (list.staff.length === 1) setExpandedStaff(list.staff[0].id)
    } catch (err: any) {
      toast.error(err.message || 'Could not load attendance')
    } finally {
      setLoading(false)
    }
  }, [from, to, month])

  useEffect(() => {
    void load()
  }, [load])

  const key = (staffId: string, date: string) => `${staffId}|${date}`

  const setStatus = async (staffId: string, date: string, status: AttendanceStatus | null) => {
    setSaving(true)
    try {
      await api.upsertAttendance({ staffId, date, status })
      setMap((prev) => {
        const copy = { ...prev }
        const k = key(staffId, date)
        if (status) copy[k] = status
        else delete copy[k]
        return copy
      })
      const sum = await api.getAttendanceSummary(month)
      setSummary(sum.staff)
      setWorkingDays(sum.workingDaysInMonth)
      setPicker(null)
    } catch (err: any) {
      toast.error(err.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const markAllPresentToday = async () => {
    if (!days.includes(today)) {
      toast.error('Today is outside this month — switch to the current month')
      return
    }
    setSaving(true)
    try {
      const res = await api.bulkAttendance({ date: today, status: 'PRESENT' })
      toast.success(`Marked ${res.updated} staff present for today`)
      await load()
    } catch (err: any) {
      toast.error(err.message || 'Bulk mark failed')
    } finally {
      setSaving(false)
    }
  }

  const isOpenDay = (dateStr: string) => openWeekdays.includes(weekdayIndex(dateStr))

  if (!config?.enableMultiStaff) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Attendance</h1>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          Enable <strong>Multi-staff</strong> in{' '}
          <Link to="/dashboard/settings" className="underline text-primary">Settings</Link>
          {' '}to use attendance, salary estimates, and staff performance.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Toolbar: title + legend + controls */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Attendance</h1>
          <p className="text-sm text-gray-500 mt-1">
            Mark daily attendance for salary estimates and see performance for the month.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            {STATUSES.map((s) => (
              <span key={s.value} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${s.className}`}>
                <span className={`w-5 h-5 rounded-md text-[10px] font-bold inline-flex items-center justify-center ${s.filled}`}>{s.short}</span>
                {s.label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-dashed border-gray-300 text-gray-500 bg-gray-50">
              Closed day
            </span>
            <span className="text-gray-500 pl-1">
              Working days: <strong className="text-gray-800">{workingDays}</strong>
            </span>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center shrink-0">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white shadow-sm"
          />
          <button
            type="button"
            disabled={saving || loading || staff.length === 0}
            onClick={() => void markAllPresentToday()}
            className="px-3.5 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50 shadow-sm hover:bg-primary-dark"
          >
            Mark all present today
          </button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500 text-sm">Loading…</div>
      ) : staff.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-gray-500 text-sm">No active staff yet.</p>
          <Link to="/dashboard/staff" className="text-primary text-sm underline mt-2 inline-block">Add staff</Link>
        </div>
      ) : (
        <>
          {/* Desktop grid */}
          <div className="hidden lg:block bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="border-collapse text-sm" style={{ minWidth: `${200 + days.length * 40}px` }}>
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="sticky left-0 z-20 bg-gray-50 text-left px-4 py-3 font-semibold text-gray-700 min-w-[180px] shadow-[4px_0_8px_-4px_rgba(0,0,0,0.12)]">
                      Staff
                    </th>
                    {days.map((d) => {
                      const dayNum = Number(d.slice(-2))
                      const open = isOpenDay(d)
                      const isToday = d === today
                      const letter = WEEKDAY_LETTERS[weekdayIndex(d)]
                      return (
                        <th
                          key={d}
                          title={d}
                          className={`px-0.5 pt-2.5 pb-1.5 text-center font-normal w-10 ${
                            isToday ? 'bg-primary-light/50' : open ? 'bg-gray-50' : 'bg-gray-100/80'
                          }`}
                        >
                          <div className={`text-[10px] uppercase tracking-wide leading-none mb-0.5 ${
                            isToday ? 'text-primary font-semibold' : open ? 'text-gray-400' : 'text-gray-300'
                          }`}>
                            {letter}
                          </div>
                          <div className={`text-xs leading-none ${
                            isToday ? 'text-primary font-bold' : open ? 'text-gray-700 font-medium' : 'text-gray-400'
                          }`}>
                            {dayNum}
                          </div>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {staff.map((s, rowIdx) => (
                    <tr key={s.id} className={`border-b border-gray-100 last:border-0 ${rowIdx % 2 === 1 ? 'bg-gray-50/40' : 'bg-white'}`}>
                      <td className={`sticky left-0 z-10 px-4 py-2.5 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.12)] ${rowIdx % 2 === 1 ? 'bg-gray-50' : 'bg-white'}`}>
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0" style={{ backgroundColor: s.color }}>
                            {s.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                          </span>
                          <div className="min-w-0">
                            <p className="font-semibold text-gray-900 truncate leading-tight">{s.name}</p>
                            {s.role && <p className="text-[11px] text-gray-500 truncate leading-tight mt-0.5">{s.role}</p>}
                          </div>
                        </div>
                      </td>
                      {days.map((d) => {
                        const st = map[key(s.id, d)]
                        const meta = statusMeta(st)
                        const open = isOpenDay(d)
                        const isToday = d === today
                        return (
                          <td
                            key={d}
                            className={`px-0.5 py-1.5 text-center ${isToday ? 'bg-primary-light/40' : !open ? 'bg-[repeating-linear-gradient(-45deg,transparent,transparent_3px,#f3f4f6_3px,#f3f4f6_4px)]' : ''}`}
                          >
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => setPicker({ staffId: s.id, date: d, name: s.name })}
                              className={`w-9 h-9 rounded-lg border text-xs font-bold transition-all hover:ring-2 hover:ring-primary/30 hover:scale-105 ${
                                meta
                                  ? meta.filled
                                  : open
                                    ? 'bg-white border-gray-200 text-gray-300 hover:border-primary hover:text-primary'
                                    : 'bg-transparent border-gray-200/60 text-gray-300 hover:border-gray-300'
                              }`}
                              title={`${s.name} · ${d}${meta ? ` · ${meta.label}` : open ? '' : ' · closed weekday'}`}
                            >
                              {meta?.short || '·'}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="lg:hidden space-y-3">
            {staff.map((s) => {
              const open = expandedStaff === s.id
              const sum = summary.find((x) => x.id === s.id)
              return (
                <div key={s.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <button
                    type="button"
                    className="w-full flex items-center gap-3 p-4 text-left"
                    onClick={() => setExpandedStaff(open ? null : s.id)}
                  >
                    <span className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0" style={{ backgroundColor: s.color }}>
                      {s.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{s.name}</p>
                      <p className="text-xs text-gray-500">
                        {sum
                          ? `${sum.presentDays}P · ${sum.halfDays}H · ${sum.absentDays}A · est ${inr(sum.estimatedPayable)}`
                          : 'Tap to mark days'}
                      </p>
                    </div>
                    <span className="text-gray-400 text-sm">{open ? '▴' : '▾'}</span>
                  </button>
                  {open && (
                    <div className="px-4 pb-4 grid grid-cols-7 gap-1.5">
                      {days.map((d) => {
                        const st = map[key(s.id, d)]
                        const meta = statusMeta(st)
                        const dayOpen = isOpenDay(d)
                        return (
                          <button
                            key={d}
                            type="button"
                            disabled={saving}
                            onClick={() => setPicker({ staffId: s.id, date: d, name: s.name })}
                            className={`aspect-square rounded-lg border text-[10px] font-semibold flex flex-col items-center justify-center ${
                              meta
                                ? meta.filled
                                : dayOpen
                                  ? 'bg-white border-gray-200 text-gray-400'
                                  : 'bg-gray-50 border-transparent text-gray-300'
                            }`}
                          >
                            <span className="text-[9px] opacity-70">{Number(d.slice(-2))}</span>
                            <span>{meta?.short || '·'}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Salary + performance summary */}
      {!loading && summary.length > 0 && (
        <div className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Month summary</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Estimated salary = (Present + ½×Half-day) × monthly salary ÷ {workingDays || '—'} working days.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {summary.map((s) => (
              <div key={s.id} className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-3">
                <div className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-gray-900 truncate">{s.name}</p>
                    {s.role && <p className="text-[11px] text-gray-500 truncate">{s.role}</p>}
                  </div>
                </div>
                <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5 flex items-end justify-between gap-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Est. salary</p>
                    <p className="text-lg font-bold text-gray-900 leading-tight">{inr(s.estimatedPayable)}</p>
                  </div>
                  <div className="text-right text-xs text-gray-500">
                    <p className="font-medium text-gray-700">{s.presentDays}P · {s.halfDays}H · {s.absentDays}A · {s.leaveDays}L</p>
                    {s.salary != null && <p className="text-[11px]">of {inr(s.salary)}/mo</p>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border border-gray-100 px-2.5 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">Bookings</p>
                    <p className="font-semibold text-gray-800 mt-0.5">{s.completedBookings}/{s.totalBookings}</p>
                    <p className="text-gray-500">{s.completionRate}% done</p>
                  </div>
                  <div className="rounded-lg border border-gray-100 px-2.5 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">Collections</p>
                    <p className="font-semibold text-gray-800 mt-0.5">{inr(s.collected)}</p>
                    {s.commissionPercent != null && (
                      <p className="text-gray-500">Comm. {inr(s.commissionEarned)}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status picker sheet */}
      {picker && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={() => setPicker(null)}>
          <div
            className="w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl p-5 space-y-3 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <p className="font-semibold">{picker.name}</p>
              <p className="text-xs text-gray-500">{picker.date}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {STATUSES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  disabled={saving}
                  onClick={() => void setStatus(picker.staffId, picker.date, s.value)}
                  className={`py-3 rounded-xl border text-sm font-medium ${s.className} disabled:opacity-50`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={() => void setStatus(picker.staffId, picker.date, null)}
              className="w-full py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600"
            >
              Clear mark
            </button>
            <button type="button" onClick={() => setPicker(null)} className="w-full text-xs text-gray-400 py-1">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

type AttendanceListResponseStaff = {
  id: string
  name: string
  role: string | null
  color: string
  salary: number | null
  commissionPercent: number | null
}
