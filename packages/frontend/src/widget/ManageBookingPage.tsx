import React, { useState } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { api } from '../lib/api'
import toast from 'react-hot-toast'

interface BookingView {
  id: string
  customerName: string
  date: string
  startTime: string
  endTime: string
  status: string
  serviceName: string | null
  staffName: string | null
  finalPrice: number | null
  location?: { address: string | null; latitude: number | null; longitude: number | null; directionsUrl: string | null } | null
}

/**
 * Customer booking management. Reads bookingId + token from the URL once and
 * keeps them in memory only (never localStorage).
 */
export const ManageBookingPage: React.FC = () => {
  const { slug: identifier, bookingId } = useParams<{ slug: string; bookingId: string }>()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''

  const [stage, setStage] = useState<'loading' | 'otp' | 'ready' | 'cancelled' | 'error'>('loading')
  const [booking, setBooking] = useState<BookingView | null>(null)
  const [refund, setRefund] = useState<{ status: string; amount: number; message: string } | null>(null)
  const [sessionToken, setSessionToken] = useState('')
  const [masked, setMasked] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  React.useEffect(() => {
    if (!identifier || !bookingId || !token) {
      setError('This link is missing the required booking details.')
      setStage('error')
      return
    }
    api.manageSession(identifier, bookingId, token)
      .then((res) => {
        if (res.otpRequired) {
          setStage('otp')
        } else if (res.sessionToken && res.booking) {
          setSessionToken(res.sessionToken)
          setBooking(res.booking)
          setStage('ready')
        } else {
          setError('Unable to open this booking.')
          setStage('error')
        }
      })
      .catch((e) => {
        setError(e.message || 'Invalid or expired link.')
        setStage('error')
      })
  }, [identifier, bookingId, token])

  const requestOtp = async () => {
    if (!identifier || !bookingId) return
    setBusy(true)
    try {
      const res = await api.manageRequestOtp(identifier, bookingId, token)
      setMasked(res.maskedDestination)
      toast.success('Verification code sent')
    } catch (e: any) {
      toast.error(e.message || 'Unable to send code')
    } finally {
      setBusy(false)
    }
  }

  const verifyOtp = async () => {
    if (!identifier || !bookingId) return
    setBusy(true)
    try {
      const res = await api.manageVerifyOtp(identifier, bookingId, token, code)
      setSessionToken(res.sessionToken)
      setBooking(res.booking)
      setStage('ready')
    } catch (e: any) {
      toast.error(e.message || 'Invalid code')
    } finally {
      setBusy(false)
    }
  }

  const doCancel = async () => {
    if (!identifier || !bookingId) return
    if (!window.confirm('Cancel this booking?')) return
    setBusy(true)
    try {
      const result = await api.manageCancelBooking(identifier, bookingId, sessionToken)
      setBooking(result.booking)
      setRefund(result.refund || null)
      // Notify an owner calendar open in another tab on the same browser.
      if ('BroadcastChannel' in window) {
        const channel = new BroadcastChannel('slotbook-bookings')
        channel.postMessage({ type: 'BOOKING_CANCELLED', bookingId })
        channel.close()
      }
      setStage('cancelled')
      if (!result.refund) {
        toast.success('Booking cancelled')
      } else if (result.refund.status === 'FAILED') {
        toast.error('Booking cancelled, but the refund needs salon action.')
      } else {
        toast.success('Booking cancelled — refund initiated')
      }
    } catch (e: any) {
      toast.error(e.message || 'Cancel failed')
    } finally {
      setBusy(false)
    }
  }

  const inputCls = 'w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800'

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary-light to-white dark:from-gray-900 dark:to-gray-950 flex items-start justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-6 mt-8 space-y-5">
        {stage === 'loading' && <p className="text-center text-sm text-gray-500 py-8">Loading your booking…</p>}

        {stage === 'error' && (
          <div className="text-center py-8 space-y-3">
            <div className="text-3xl">🔒</div>
            <h1 className="font-bold">Booking link invalid</h1>
            <p className="text-sm text-gray-500">{error}</p>
            <Link to="/" className="inline-block text-sm text-primary hover:underline">Go home</Link>
          </div>
        )}

        {stage === 'otp' && (
          <div className="space-y-4">
            <h1 className="font-bold text-lg">Verify it's you</h1>
            <p className="text-sm text-gray-500">
              {masked
                ? `We sent a verification code to ${masked}.`
                : 'This business requires a verification code to manage bookings.'}
            </p>
            {!masked && (
              <button onClick={requestOtp} disabled={busy} className="w-full py-2.5 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">
                {busy ? 'Sending…' : 'Send Code'}
              </button>
            )}
            {masked && (
              <>
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" inputMode="numeric" maxLength={6} className={inputCls} />
                <button onClick={verifyOtp} disabled={busy || code.length !== 6} className="w-full py-2.5 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">
                  {busy ? 'Verifying…' : 'Verify'}
                </button>
                <button onClick={requestOtp} disabled={busy} className="w-full text-center text-xs text-gray-400 hover:text-primary">Resend code</button>
              </>
            )}
          </div>
        )}

        {stage === 'ready' && booking && (
          <div className="space-y-5">
            <h1 className="font-bold text-lg">Your Booking</h1>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-1 text-sm">
              <p><span className="text-gray-500">Service:</span> <span className="font-medium">{booking.serviceName || 'Appointment'}</span></p>
              {booking.staffName && <p><span className="text-gray-500">Staff:</span> {booking.staffName}</p>}
              <p><span className="text-gray-500">Date:</span> {new Date(booking.date).toLocaleDateString('en-IN')}</p>
              <p><span className="text-gray-500">Time:</span> {booking.startTime} - {booking.endTime}</p>
              {booking.finalPrice != null && <p><span className="text-gray-500">Amount:</span> ₹{booking.finalPrice}</p>}
              <p>
                <span className="text-gray-500">Status:</span>{' '}
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${booking.status === 'CONFIRMED' ? 'bg-green-100 text-green-700' : booking.status === 'CANCELLED' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                  {booking.status}
                </span>
              </p>
            </div>

            {booking.location?.directionsUrl && (
              <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg p-4 space-y-1 text-sm">
                <p className="font-medium">📍 Salon location</p>
                {booking.location.address && <p className="text-xs text-gray-600 dark:text-gray-400">{booking.location.address}</p>}
                <a href={booking.location.directionsUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-block text-sm text-indigo-600 dark:text-indigo-400 font-medium hover:underline">
                  🗺️ Get directions
                </a>
              </div>
            )}

            {booking.status === 'CONFIRMED' && (
              <button onClick={doCancel} disabled={busy} className="w-full py-2.5 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 disabled:opacity-50">
                {busy ? 'Cancelling…' : 'Cancel Booking'}
              </button>
            )}
          </div>
        )}

        {stage === 'cancelled' && (
          <div className="text-center py-8 space-y-3">
            <div className="text-3xl">👍</div>
            <h1 className="font-bold">Booking cancelled</h1>
            {refund && refund.status === 'FAILED' ? (
              <>
                <p className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                  Booking cancelled, but the automatic refund needs the salon to complete it. We have notified the salon.
                </p>
                <p className="text-xs text-gray-400">Refund of ₹{refund.amount} pending salon action.</p>
              </>
            ) : refund ? (
              <>
                <p className="text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2">
                  Refund initiated to your original payment method. It may be instant; otherwise allow 5–7 working days.
                </p>
                <p className="text-xs text-gray-400">Refund of ₹{refund.amount} for your cancelled booking.</p>
              </>
            ) : (
              <p className="text-sm text-gray-500">Your appointment has been cancelled.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
