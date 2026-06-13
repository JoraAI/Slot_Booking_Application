import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '../../lib/api'
import toast from 'react-hot-toast'

interface PaymentStepProps {
  slug: string
  amount: number
  depositAmount?: number | null
  paymentMode: 'full' | 'deposit' | 'none'
  serviceName: string
  testMode?: boolean
  bookingData: Record<string, unknown>
  onPaymentSuccess: (booking: any) => void
  onBack: () => void
}

const UPI_APPS = [
  { name: 'Google Pay', short: 'GPay', color: '#4285F4', icon: 'G' },
  { name: 'PhonePe', short: 'PhonePe', color: '#5F259F', icon: 'P' },
  { name: 'Paytm', short: 'Paytm', color: '#00BAF2', icon: '₿' },
  { name: 'BHIM', short: 'BHIM', color: '#009C5A', icon: 'B' },
]

export const PaymentStep: React.FC<PaymentStepProps> = ({
  slug,
  amount,
  depositAmount,
  paymentMode,
  serviceName,
  testMode = false,
  bookingData,
  onPaymentSuccess,
  onBack,
}) => {
  const [loading, setLoading] = useState(false)
  const [expandedMethods, setExpandedMethods] = useState(false)
  const dueNow = paymentMode === 'deposit' && depositAmount ? depositAmount : amount
  const remainder = paymentMode === 'deposit' && depositAmount ? amount - depositAmount : 0

  const handlePay = async () => {
    setLoading(true)
    try {
      const order = await api.initiatePayment(slug, { amount: dueNow })

      if (testMode || order.orderId?.startsWith('order_test_')) {
        // Test mode: skip Razorpay checkout, verify directly with mock data
        const mockPaymentId = `pay_test_${Date.now()}`
        const mockSignature = 'test_signature'

        const result = await api.verifyPayment(slug, {
          razorpay_order_id: order.orderId,
          razorpay_payment_id: mockPaymentId,
          razorpay_signature: mockSignature,
          bookingData,
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
        name: order.name || serviceName,
        description: `Booking for ${serviceName}`,
        handler: async (response: any) => {
          try {
            const result = await api.verifyPayment(slug, {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              bookingData,
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
      className="space-y-5"
    >
      <div>
        <h3 className="text-lg font-semibold">Payment</h3>
        <p className="text-sm text-gray-500">Complete your booking by making a payment</p>
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
      </div>

      {/* Payment Methods */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Pay Using</p>

        {/* UPI Apps */}
        <div className="grid grid-cols-4 gap-2">
          {UPI_APPS.map((upi) => (
            <button
              key={upi.name}
              onClick={handlePay}
              disabled={loading}
              className="flex flex-col items-center gap-1.5 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-primary hover:shadow-sm transition-all disabled:opacity-50 group"
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                style={{ backgroundColor: upi.color }}
              >
                {upi.icon}
              </div>
              <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400 group-hover:text-primary">
                {upi.short}
              </span>
            </button>
          ))}
        </div>

        {/* Other methods toggle */}
        <button
          onClick={() => setExpandedMethods(!expandedMethods)}
          className="w-full text-center text-sm text-gray-500 hover:text-primary py-2 transition-colors"
        >
          {expandedMethods ? '▲ Less options' : '▼ More payment options'}
        </button>

        {expandedMethods && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            className="grid grid-cols-3 gap-2"
          >
            {[
              { name: 'Credit/Debit Card', icon: '💳', desc: 'Visa, Mastercard, Rupay' },
              { name: 'Net Banking', icon: '🏦', desc: 'All major banks' },
              { name: 'Wallets', icon: '👛', desc: 'Amazon Pay, Mobikwik' },
            ].map((method) => (
              <button
                key={method.name}
                onClick={handlePay}
                disabled={loading}
                className="flex flex-col items-center gap-1 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-primary hover:shadow-sm transition-all disabled:opacity-50"
              >
                <span className="text-xl">{method.icon}</span>
                <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400 text-center leading-tight">{method.name}</span>
                <span className="text-[9px] text-gray-400 text-center leading-tight">{method.desc}</span>
              </button>
            ))}
          </motion.div>
        )}
      </div>

      {/* Pay button */}
      <button
        onClick={handlePay}
        disabled={loading}
        className="w-full py-3.5 bg-primary hover:bg-primary-dark text-white rounded-xl font-semibold text-sm disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Processing...
          </>
        ) : (
          <>Pay ₹{dueNow.toLocaleString('en-IN')}</>
        )}
      </button>

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