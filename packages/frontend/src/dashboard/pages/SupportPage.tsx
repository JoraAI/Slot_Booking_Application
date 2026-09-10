import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import { useStore } from '../../store'

const CATEGORIES = [
  { value: 'bug', label: 'Bug' },
  { value: 'enhancement', label: 'Enhancement / feature request' },
  { value: 'billing', label: 'Billing / subscription' },
  { value: 'account', label: 'Account / access' },
  { value: 'other', label: 'Other' },
] as const

type Category = (typeof CATEGORIES)[number]['value']

const inputClass =
  'w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-primary/30'

export const SupportPage: React.FC = () => {
  const { config } = useStore()
  const [category, setCategory] = useState<Category>('bug')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const sub = subject.trim()
    const msg = message.trim()
    if (sub.length < 3) {
      toast.error('Subject must be at least 3 characters')
      return
    }
    if (msg.length < 10) {
      toast.error('Please describe the issue in at least 10 characters')
      return
    }
    setSending(true)
    try {
      await api.submitSupportTicket({ category, subject: sub, message: msg })
      setSent(true)
      setSubject('')
      setMessage('')
      setCategory('bug')
      toast.success('Ticket sent — we will reply by email')
    } catch (err: any) {
      toast.error(err?.message || 'Could not send ticket')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4 sm:space-y-6 px-0 sm:px-0">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">Support</h1>
        <p className="text-sm text-gray-500 mt-1">
          Raise a ticket for bugs, enhancements, or account help. Messages go to{' '}
          <a className="text-primary underline break-all" href="mailto:admin@staffingpros.tech">
            admin@staffingpros.tech
          </a>
          .
        </p>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 sm:p-6 space-y-4">
        {config && (
          <div className="text-xs sm:text-sm text-gray-500 bg-gray-50 dark:bg-gray-800/60 rounded-lg px-3 py-2 space-y-0.5">
            <p>
              Shop: <span className="text-gray-800 dark:text-gray-200 font-medium">{config.name}</span>
            </p>
            <p className="break-all">
              Reply will go to your login email. We include shop details automatically.
            </p>
          </div>
        )}

        {sent && (
          <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-800 px-3 py-2 text-sm text-green-800 dark:text-green-300">
            Ticket submitted. Check your inbox for our reply (we use your account email as Reply-To).
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="support-category">
              Category
            </label>
            <select
              id="support-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              className={inputClass}
              disabled={sending}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="support-subject">
              Subject
            </label>
            <input
              id="support-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={120}
              placeholder="Short summary"
              className={inputClass}
              disabled={sending}
              autoComplete="off"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="support-message">
              Details
            </label>
            <textarea
              id="support-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={4000}
              rows={8}
              placeholder="What happened? Steps to reproduce, device/browser, or what you’d like improved…"
              className={`${inputClass} min-h-[160px] resize-y`}
              disabled={sending}
            />
            <p className="text-xs text-gray-400 mt-1 text-right">{message.trim().length}/4000</p>
          </div>

          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:items-center sm:justify-between pt-1">
            <a
              href="mailto:admin@staffingpros.tech"
              className="text-sm text-gray-500 hover:text-primary text-center sm:text-left underline-offset-2 hover:underline"
            >
              Or email us directly
            </a>
            <button
              type="submit"
              disabled={sending}
              className="w-full sm:w-auto px-5 py-2.5 bg-primary hover:bg-primary-dark text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Submit ticket'}
            </button>
          </div>
        </form>
      </div>

      <p className="text-xs text-gray-400 leading-relaxed">
        Tip: include screenshots by describing what you see, or attach them when you reply to our email.
        Limit: a few tickets per hour per shop.
      </p>
    </div>
  )
}
