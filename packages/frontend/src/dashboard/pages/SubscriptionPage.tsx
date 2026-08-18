import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'

declare global {
  interface Window {
    Razorpay: any
  }
}

type Plan = 'COMMISSION' | 'MONTHLY_799' | 'YEARLY_799'

interface SubView {
  plan: Plan
  status: 'ACTIVE' | 'PAST_DUE'
  isActive: boolean
  dueInr: number
  paidInr: number
  currentMonthKey: string | null
  currentCycleEndsAt: string | null
}

const PLAN_INFO: Record<Plan, { title: string; price: string; desc: string; features: string[] }> = {
  COMMISSION: {
    title: 'Commission',
    price: '5% per booking',
    desc: 'Pay a small percentage on each booking — ideal for businesses just starting out.',
    features: [
      'Unlimited bookings',
      '5% commission on all bookings (incl. cancelled)',
      'All features included',
      'No upfront cost',
    ],
  },
  MONTHLY_799: {
    title: 'Monthly',
    price: '₹799 / month',
    desc: 'Fixed monthly fee with zero commission — great for growing salons.',
    features: [
      'Unlimited bookings',
      'Zero commission',
      'All features included',
      'Cancel anytime',
    ],
  },
  YEARLY_799: {
    title: 'Yearly',
    price: '₹9,588 / year',
    desc: 'Best value — pay yearly and save. Same benefits as monthly.',
    features: [
      'Unlimited bookings',
      'Zero commission',
      'All features included',
      '₹799 × 12 months',
    ],
  },
}

export const SubscriptionPage: React.FC = () => {
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<SubView | null>(null)
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

  useEffect(() => { refresh() }, [])

  const choosePlan = async (plan: Plan) => {
    setBusy(true)
    try {
      await api.selectOwnerSubscriptionPlan(plan)
      toast.success('Plan selected')
      await refresh()
    } catch (e: any) {
      toast.error(e.message || 'Could not update plan')
    } finally {
      setBusy(false)
    }
  }

  const handlePay = async () => {
    setBusy(true)
    try {
      const res = await api.createSubscriptionPayment()
      if (res.alreadyPaid) {
        toast.success('Already paid — subscription is active!')
        await refresh()
        return
      }
      if (!res.orderId || !res.keyId) {
        toast.error('Could not initiate payment')
        return
      }

      const options = {
        key: res.keyId,
        amount: res.amountPaise,
        currency: res.currency || 'INR',
        name: 'Reservly',
        description: `Subscription — ${res.plan}`,
        order_id: res.orderId,
        handler: async (response: any) => {
          try {
            await api.verifySubscriptionPayment({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            })
            toast.success('Payment verified — subscription activated!')
            await refresh()
          } catch (e: any) {
            toast.error(e.message || 'Payment verification failed')
          }
        },
        theme: { color: '#6366f1' },
      }

      if (!window.Razorpay) {
        toast.error('Payment gateway not loaded. Please refresh the page.')
        return
      }
      const rzp = new window.Razorpay(options)
      rzp.open()
    } catch (e: any) {
      toast.error(e.message || 'Payment error')
    } finally {
      setBusy(false)
    }
  }

  const currentPlan = view?.plan || 'COMMISSION'

  return (
    <div className="max-w-4xl space-y-8">
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

      {/* Current status */}
      {view && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm text-gray-500">Current Plan</p>
              <p className="text-lg font-semibold">{PLAN_INFO[currentPlan].title}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500">Status</p>
              <p className={`text-lg font-semibold ${view.isActive ? 'text-green-600' : 'text-amber-600'}`}>
                {view.isActive ? '● Active' : '● Paused (payment due)'}
              </p>
            </div>
          </div>
          {view.dueInr > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between flex-wrap gap-4">
              <div>
                <p className="text-sm text-gray-500">Amount Due</p>
                <p className="text-2xl font-bold">₹{view.dueInr}</p>
                {view.currentMonthKey && <p className="text-xs text-gray-400 mt-1">For: {view.currentMonthKey}</p>}
                {view.currentCycleEndsAt && <p className="text-xs text-gray-400">Cycle ends: {new Date(view.currentCycleEndsAt).toLocaleDateString()}</p>}
              </div>
              <button
                onClick={handlePay}
                disabled={busy}
                className="px-6 py-3 bg-primary text-white rounded-lg font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors"
              >
                {busy ? 'Processing...' : 'Pay Now'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Plan cards */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Choose a Plan</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {(Object.entries(PLAN_INFO) as [Plan, typeof PLAN_INFO[Plan]][]).map(([plan, info]) => {
            const isCurrent = currentPlan === plan
            return (
              <div
                key={plan}
                className={`rounded-xl border-2 p-5 flex flex-col transition-colors ${
                  isCurrent
                    ? 'border-primary bg-primary/5'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                }`}
              >
                {isCurrent && (
                  <span className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">Current Plan</span>
                )}
                <h3 className="text-lg font-bold">{info.title}</h3>
                <p className="text-primary font-semibold mt-1">{info.price}</p>
                <p className="text-sm text-gray-500 mt-2">{info.desc}</p>
                <ul className="mt-4 space-y-1.5 flex-1">
                  {info.features.map((f, i) => (
                    <li key={i} className="text-sm text-gray-600 dark:text-gray-400 flex items-start gap-2">
                      <span className="text-green-500 mt-0.5">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                {!isCurrent && (
                  <button
                    onClick={() => choosePlan(plan)}
                    disabled={busy}
                    className="mt-4 w-full py-2 rounded-lg border border-primary text-primary font-medium hover:bg-primary hover:text-white transition-colors disabled:opacity-50"
                  >
                    {busy ? '...' : 'Switch to this plan'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <p className="text-xs text-gray-400">
        Payments are securely processed via Razorpay. Commission is calculated on all bookings for the current month.
        If payment is overdue, booking services are paused until payment is completed — you still have full access to the dashboard.
      </p>
    </div>
  )
}
