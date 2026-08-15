import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '../../lib/api'
import toast from 'react-hot-toast'
import { upiFirstDisplay } from '../razorpayDisplay'
import { BusyOverlay } from '../../components/BusyOverlay'

interface PaymentStepProps {
  slug: string
  amount: number
  discountAmount?: number | null
  discountLabel?: string | null
  depositAmount?: number | null
  paymentMode: 'full' | 'deposit' | 'none'
  serviceName: string
  serviceId: string
  date: string
  startTime: string
  testMode?: boolean
  /** Salon business name — shown as the receiver branding before checkout. */
  businessName: string
  bookingData: Record<string, unknown>
  onPaymentSuccess: (booking: any) => void
  onBack: () => void
}

/**
 * Batch 2A — UPI Intent checkout (two-step).
 *
 * - "Pay with UPI apps" initiates the order server-side FIRST; the
 *   server-confirmed payable amount and the salon name are then shown on a
 *   confirmation panel before the Razorpay Checkout opens (no misleading
 *   "amount confirmed" while opening in the same tick).
 * - The Razorpay `display` config is explicitly UPI-first (`sequence` +
 *   `show_default_blocks: false`) — see `razorpayDisplay.ts`.
 * - No raw "receiver UPI ID" is collected; funds settle to the salon's own
 *   Razorpay account.
 * - `bookingData.formData` is forwarded to payment initiation so paid bookings
 *   preserve the same custom customer fields as unpaid bookings.
 */
export const PaymentStep: React.FC<PaymentStepProps> = ({
  slug,
  amount,
  discountAmount,
  discountLabel,
  depositAmount,
  paymentMode,
  serviceName,
  serviceId,
  date,
  startTime,
  testMode = false,
  businessName,
  bookingData,
  onPaymentSuccess,
  onBack,
}) => {
  const [loading, setLoading] = useState(false)
  // Server-confirmed values from the initiate response.
  const [pendingOrder, setPendingOrder] = useState<any | null>(null)
  const [serverPayable, setServerPayable] = useState<number | null>(null)
  const [receiverName, setReceiverName] = useState<string>(businessName)

  const dueNow = serverPayable ?? (paymentMode === 'deposit' && depositAmount ? depositAmount : amount)
  const remainder = paymentMode === 'deposit' && depositAmount ? amount - depositAmount : 0

  const openCheckout = async (order: any) => {
    if (testMode || order.orderId?.startsWith('order_test_')) {
      // Test mode: skip Razorpay checkout, verify directly with mock data
      const mockPaymentId = `pay_test_${Date.now()}`
      const mockSignature = 'test_signature'

      const result = await api.verifyPayment(slug, {
        razorpay_order_id: order.orderId,
        razorpay_payment_id: mockPaymentId,
        razorpay_signature: mockSignature,
      })

      if (result.booking) {
        onPaymentSuccess(result.booking)
        toast.success('Payment successful! (Test Mode)')
      }
      return
    }

    // Live mode: open Razorpay checkout
    // @ts-ignore
    if (!window.Razorpay) {
      toast.error('Payment gateway is loading. Please wait a moment and try again.')
      return
    }

    const options: any = {
      key: order.key,
      amount: order.amount,
      currency: order.currency || 'INR',
      order_id: order.orderId,
      name: order.name || businessName,
      description: `Booking for ${serviceName}`,
      display: upiFirstDisplay,
      handler: async (response: any) => {
        try {
          const result = await api.verifyPayment(slug, {
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          })
          if (result.booking) {
            onPaymentSuccess(result.booking)
            toast.success('Payment successful!')
          }
        } catch {
          toast.error('Payment verification failed')
        }
      },
      prefill: {
        name: (bookingData.customerName as string) || '',
        email: (bookingData.customerEmail as string) || '',
        contact: (bookingData.customerPhone as string) || '',
      },
      theme: { color: '#7C3AED' },
      modal: {
        ondismiss: () => {
          toast.error('Payment cancelled')
        },
      },
    }

    // @ts-ignore
    const rzp = new window.Razorpay(options)
    rzp.on('payment.failed', (response: any) => {
      toast.error(`Payment failed: ${response.error.description}`)
    })
    rzp.open()
  }

  const handleOpenCheckout = async (order: any) => {
    setLoading(true)
    try {
      await openCheckout(order)
    } catch (err: any) {
      toast.error(err.message || 'Could not open payment')
    } finally {
      setLoading(false)
    }
  }

  const handlePay = async () => {
    setLoading(true)
    try {
      const order = await api.initiatePayment(slug, {
        serviceId,
        date,
        startTime,
        staffId: (bookingData.staffId as string) || null,
        source: (bookingData.source as string) || undefined,
        customerName: (bookingData.customerName as string) || '',
        customerPhone: (bookingData.customerPhone as string) || '',
        customerEmail: (bookingData.customerEmail as string) || null,
        // Preserve custom form fields on the paid booking (Batch 2A P1).
        formData: (bookingData.formData as Record<string, unknown>) || {},
      })

      // Free booking (finalPrice = 0): server creates the booking directly.
      if (order.free && order.booking) {
        onPaymentSuccess(order.booking)
        toast.success('Booking confirmed!')
        return
      }

      // Two-step: show the server-confirmed amount + receiver before opening.
      if (order.payable != null) setServerPayable(order.payable)
      if (order.name) setReceiverName(order.name)
      setPendingOrder(order)
    } catch (err: any) {
      toast.error(err.message || 'Failed to initiate payment')
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="relative space-y-5"
    >
      <BusyOverlay show={loading} message={pendingOrder ? 'Opening secure payment…' : 'Confirming amount…'} />

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Payment</h3>
          <p className="text-sm text-gray-500">Complete your booking by making a payment</p>
        </div>
        <button onClick={onBack} className="text-sm text-gray-400 hover:text-primary">Back</button>
      </div>

      {/* Test mode banner */}
      {testMode && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <span className="text-amber-600 text-lg">⚠️</span>
          <div>
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Test Mode Active</p>
            <p className="text-xs text-amber-600 dark:text-amber-500">No real charges will be made. Payment will be simulated.</p>
          </div>
        </div>
      )}

      {/* Price breakdown */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Service</span>
          <span className="font-medium">{serviceName}</span>
        </div>
        {discountAmount ? (
          <>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Original Price</span>
              <span className="font-medium line-through">₹{(amount + discountAmount).toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Discount{discountLabel ? ` (${discountLabel})` : ''}</span>
              <span className="font-medium text-emerald-600">-₹{discountAmount.toLocaleString('en-IN')}</span>
            </div>
          </>
        ) : null}
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Total Price</span>
          <span className="font-semibold">₹{amount.toLocaleString('en-IN')}</span>
        </div>
        {paymentMode === 'deposit' && depositAmount && (
          <>
            <div className="flex justify-between text-sm">
              <span className="text-emerald-600">Due Now (Deposit)</span>
              <span className="font-semibold text-emerald-600">₹{dueNow.toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-400">
              <span>Pay at Venue</span>
              <span>₹{remainder.toLocaleString('en-IN')}</span>
            </div>
          </>
        )}
        <hr className="border-gray-100 dark:border-gray-700" />
        <div className="flex justify-between items-center">
          <span className="font-semibold">Amount to Pay</span>
          <span className="text-xl font-bold text-primary">₹{dueNow.toLocaleString('en-IN')}</span>
        </div>
        {/* Receiver branding: the salon's own Razorpay account. */}
        <div className="flex items-center justify-between text-xs text-gray-400 border-t border-gray-100 dark:border-gray-700 pt-2">
          <span>Paid to <span className="font-medium text-gray-600 dark:text-gray-300">{receiverName}</span></span>
          <span>via Razorpay</span>
        </div>
      </div>

      {/* Server-confirmed step (before Checkout opens) */}
      {pendingOrder ? (
        <div className="space-y-4">
          <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 space-y-2">
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">✓ Amount confirmed by {receiverName}</p>
            <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
              ₹{(serverPayable ?? dueNow).toLocaleString('en-IN')}
            </p>
            <p className="text-xs text-gray-500">
              This is the exact amount the server will charge. Continue to pay securely via UPI apps, card, net banking or wallets.
            </p>
          </div>
          <button
            onClick={() => handleOpenCheckout(pendingOrder)}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-primary hover:bg-primary-dark text-white rounded-xl font-semibold text-sm disabled:opacity-50 transition-colors"
          >
            <span className="text-lg" aria-hidden>🔒</span>
            {loading ? 'Opening secure payment…' : 'Continue to secure payment'}
          </button>
          <button
            onClick={() => setPendingOrder(null)}
            disabled={loading}
            className="w-full text-center text-sm text-gray-500 hover:text-primary py-1 transition-colors"
          >
            ← Change payment method
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Pay Using</p>

          {/* Primary CTA — UPI apps first (Razorpay UPI Intent) */}
          <button
            onClick={handlePay}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-primary hover:bg-primary-dark text-white rounded-xl font-semibold text-sm disabled:opacity-50 transition-colors"
          >
            <span className="text-lg" aria-hidden>📲</span>
            {loading ? 'Processing…' : 'Pay with UPI apps'}
          </button>
          <p className="text-xs text-gray-400 text-center -mt-1">
            Installed UPI apps (Google Pay, PhonePe, Paytm, BHIM) open automatically on your phone.
          </p>

          {/* Single truthful "More options" action — no fake per-method buttons. */}
          <button
            onClick={handlePay}
            disabled={loading}
            className="w-full text-center text-sm text-gray-500 hover:text-primary py-2 transition-colors"
          >
            More payment options — card, net banking, wallets
          </button>
        </div>
      )}

      {/* Trust badges */}
      <div className="flex items-center justify-center gap-4 text-[11px] text-gray-400">
        <span className="flex items-center gap-1">🔒 256-bit SSL</span>
        <span>•</span>
        <span>Powered by Razorpay</span>
        <span>•</span>
        <span>Secure Payment</span>
      </div>
    </motion.div>
  )
}
