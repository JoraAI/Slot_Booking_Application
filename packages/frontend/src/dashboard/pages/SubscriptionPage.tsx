import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'

type Plan = 'COMMISSION' | 'MONTHLY_799' | 'YEARLY_799'

export const SubscriptionPage: React.FC = () => {
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<null | {
    plan: Plan
    status: 'ACTIVE' | 'PAST_DUE'
    isActive: boolean
    dueInr: number
    paidInr: number
    currentMonthKey: string | null
    currentCycleEndsAt: string | null
  }>(null)
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    setLoading(true)
    try {
      const v = await api.getOwnerSubscription()
      setView(v as any)
    } catch (e: any) {
      toast.error(e.message || 'Failed to load subscription')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const choosePlan = async (plan: Plan) => {
    setBusy(true)
    try {
      await api.selectOwnerSubscriptionPlan(plan)
      toast.success('Plan updated')
      await refresh()
    } catch (e: any) {
      toast.error(e.message || 'Could not update plan')
    } finally {
      setBusy(false)
    }
  }

  const activateNow = async () => {
    setBusy(true)
    try {
      await api.markSubscriptionPaid()
      toast.success('Subscription activated (for demo/manual payment)')
      await refresh()
    } catch (e: any) {
      toast.error(e.message || 'Could not activate')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Subscription</h1>
        <button
          onClick={refresh}
          disabled={loading}
          className="px-4 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
        <h2 className="text-lg font-semibold">Current status</h2>
        {!view ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-gray-500">Plan</p>
                <p className="font-semibold">{view.plan}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-500">Service</p>
                <p className={`font-semibold ${view.isActive ? 'text-green-700' : 'text-amber-700'}`}>
                  {view.isActive ? 'Active' : 'Paused (unpaid)'}
                </p>
              </div>
            </div>
            <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
              <p className="text-sm text-gray-500">Due</p>
              <p className="text-xl font-bold">₹{view.dueInr}</p>
              {view.currentMonthKey && <p className="text-xs text-gray-500">Commission month: {view.currentMonthKey}</p>}
              {view.currentCycleEndsAt && <p className="text-xs text-gray-500">Cycle end: {new Date(view.currentCycleEndsAt).toLocaleDateString()}</p>}
            </div>
          </>
        )}
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
        <h2 className="text-lg font-semibold">Plans (info)</h2>
        <p className="text-sm text-gray-500">
          Commission plan charges 5% of the booking amount for the current month, including cancellations. Monthly/Yearly are fixed fees.
        </p>
        <div className="grid sm:grid-cols-3 gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => choosePlan('COMMISSION')}
            className={`text-left rounded-lg border p-4 ${view?.plan === 'COMMISSION' ? 'border-primary bg-primary/5' : 'border-gray-200 dark:border-gray-700'}`}
          >
            <p className="font-semibold">Commission</p>
            <p className="text-xs text-gray-500 mt-1">5% on bookings (incl. cancelled)</p>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => choosePlan('MONTHLY_799')}
            className={`text-left rounded-lg border p-4 ${view?.plan === 'MONTHLY_799' ? 'border-primary bg-primary/5' : 'border-gray-200 dark:border-gray-700'}`}
          >
            <p className="font-semibold">Monthly</p>
            <p className="text-xs text-gray-500 mt-1">₹799 / month</p>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => choosePlan('YEARLY_799')}
            className={`text-left rounded-lg border p-4 ${view?.plan === 'YEARLY_799' ? 'border-primary bg-primary/5' : 'border-gray-200 dark:border-gray-700'}`}
          >
            <p className="font-semibold">Yearly</p>
            <p className="text-xs text-gray-500 mt-1">₹799 x 12</p>
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-3">
        <h2 className="text-lg font-semibold">Activate access</h2>
        <p className="text-sm text-gray-500">
          After you complete platform payment (commission/monthly/yearly), we activate your account and customers can book again.
          (This repo currently supports manual activation via this button.)
        </p>
        <button
          onClick={activateNow}
          disabled={busy}
          className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark disabled:opacity-50"
        >
          {busy ? 'Processing...' : view?.isActive ? 'Active' : 'Mark as Paid / Activate'}
        </button>
      </div>
    </div>
  )
}
