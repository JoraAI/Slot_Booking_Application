import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import { useStore } from '../../store'

type Plan = 'COMMISSION' | 'MONTHLY_799'

export const SubscriptionPage: React.FC = () => {
  const { config, setConfig } = useStore()
  const [saving, setSaving] = useState(false)
  const [plan, setPlan] = useState<Plan>('COMMISSION')
  const [commissionPercent, setCommissionPercent] = useState<number | ''>('')
  const [monthlyInr, setMonthlyInr] = useState(799)

  useEffect(() => {
    if (!config) return
    setPlan((config.subscriptionPlan || 'COMMISSION') as Plan)
    setCommissionPercent(config.subscriptionCommissionPercent ?? '')
    setMonthlyInr(config.subscriptionMonthlyInr ?? 799)
  }, [config])

  const save = async () => {
    setSaving(true)
    try {
      const payload = {
        subscriptionPlan: plan,
        subscriptionCommissionPercent: plan === 'COMMISSION' ? (commissionPercent === '' ? null : Number(commissionPercent)) : null,
        subscriptionMonthlyInr: monthlyInr || 799,
      }
      const updated = await api.updateConfig(payload)
      setConfig({ ...(config as any), ...updated })
      toast.success('Subscription preferences saved')
    } catch (err: any) {
      toast.error(err.message || 'Could not save subscription')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Subscription</h1>
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
        <h2 className="text-lg font-semibold">Choose billing model</h2>
        <p className="text-sm text-gray-500">
          WhatsApp API usage is billed directly by Meta to the sender account. This section is your Reservly platform billing model.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setPlan('COMMISSION')}
            className={`text-left rounded-lg border p-4 ${plan === 'COMMISSION' ? 'border-primary bg-primary/5' : 'border-gray-200 dark:border-gray-700'}`}
          >
            <p className="font-semibold">Commission based</p>
            <p className="text-xs text-gray-500 mt-1">Pay a percentage on successful paid transactions.</p>
          </button>
          <button
            type="button"
            onClick={() => setPlan('MONTHLY_799')}
            className={`text-left rounded-lg border p-4 ${plan === 'MONTHLY_799' ? 'border-primary bg-primary/5' : 'border-gray-200 dark:border-gray-700'}`}
          >
            <p className="font-semibold">Monthly subscription</p>
            <p className="text-xs text-gray-500 mt-1">Flat monthly plan, default set to ₹799.</p>
          </button>
        </div>
      </div>

      {plan === 'COMMISSION' && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
          <label className="block text-sm font-medium mb-1">Commission percentage</label>
          <input
            type="number"
            min={0}
            max={30}
            step={0.25}
            value={commissionPercent}
            onChange={(e) => setCommissionPercent(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="e.g. 5"
            className="w-full max-w-xs px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800"
          />
          <p className="text-xs text-gray-400 mt-1">0-30% supported. Leave blank to keep it unset.</p>
        </div>
      )}

      {plan === 'MONTHLY_799' && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
          <label className="block text-sm font-medium mb-1">Monthly fee (INR)</label>
          <input
            type="number"
            min={0}
            max={50000}
            value={monthlyInr}
            onChange={(e) => setMonthlyInr(parseInt(e.target.value || '799', 10))}
            className="w-full max-w-xs px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800"
          />
        </div>
      )}
    </div>
  )
}
