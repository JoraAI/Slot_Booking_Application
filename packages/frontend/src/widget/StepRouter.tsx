import React, { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '../store'
import { api } from '../lib/api'
import { usePostMessage } from '../hooks'
import { StaffSelection } from './steps/StaffSelection'
import { DateTimePicker } from './steps/DateTimePicker'
import { CustomerForm, validateCustomerForm } from './steps/CustomerForm'
import { PaymentStep } from './steps/PaymentStep'
import { ConfirmationScreen } from './steps/ConfirmationScreen'
import { WaitlistSheet } from './WaitlistSheet'
import type { Booking } from '../types'
import toast from 'react-hot-toast'

const stepLabels: Record<string, string> = {
  'staff-selection': 'Staff',
  'date-time': 'Date & Time',
  'customer-form': 'Details',
  'payment': 'Payment',
  'confirmation': 'Confirmed',
}

export const StepRouter: React.FC = () => {
  const { config, wizard, setWizard } = useStore()
  const postMessage = usePostMessage()
  const [booking, setBooking] = useState<Booking | null>(null)
  const [showWaitlist, setShowWaitlist] = useState(false)
  const [waitlistTime, setWaitlistTime] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showFormErrors, setShowFormErrors] = useState(false)
  const [formValid, setFormValid] = useState(false)

  const slug = config?.slug || ''

  const steps = useMemo(() => {
    if (!config) return []
    const s: string[] = []
    if (config.enableMultiStaff) s.push('staff-selection')
    s.push('date-time')
    s.push('customer-form')
    if (config.enablePayments && config.paymentMode !== 'none') s.push('payment')
    s.push('confirmation')
    return s
  }, [config])

  const currentStep = wizard.currentStep

  const goNext = () => {
    if (currentStep < steps.length - 1) {
      setWizard({ currentStep: currentStep + 1 })
      postMessage('STEP_CHANGED', { step: steps[currentStep + 1] })
    }
  }

  const goBack = () => {
    if (currentStep > 0) {
      setWizard({ currentStep: currentStep - 1 })
      postMessage('STEP_CHANGED', { step: steps[currentStep - 1] })
    }
  }

  const hasPayment = config?.enablePayments && config?.paymentMode !== 'none'

  // Build booking data from wizard state (used for both direct booking and payment flow)
  const buildBookingData = () => {
    if (!config || !wizard.selectedDate || !wizard.selectedTime) return null
    const [hours, minutes] = wizard.selectedTime.split(':').map(Number)
    const endTime = `${String(hours + Math.floor((minutes + config.slotDurationMinutes) / 60)).padStart(2, '0')}:${String((minutes + config.slotDurationMinutes) % 60).padStart(2, '0')}`

    return {
      date: wizard.selectedDate,
      startTime: wizard.selectedTime,
      endTime,
      formData: wizard.formData,
      customerName: wizard.formData['name'] || '',
      customerPhone: wizard.formData['phone'] || '',
      customerEmail: wizard.formData['email'] || null,
      staffId: wizard.selectedStaff,
      isRecurring: wizard.isRecurring,
      recurringFrequency: wizard.isRecurring ? wizard.recurringFrequency : undefined,
      recurringCount: wizard.isRecurring ? wizard.recurringCount : undefined,
      recurringSkipDates: wizard.isRecurring ? wizard.recurringSkipDates : undefined,
      amount: config.servicePrice || 0,
    }
  }

  // Handle form submit: if payment enabled, go to payment step; otherwise, create booking directly
  const handleFormSubmit = async () => {
    if (!config || !wizard.selectedDate || !wizard.selectedTime) return

    const { isValid } = validateCustomerForm(config.formFields, wizard.formData)
    if (!isValid) {
      setShowFormErrors(true)
      toast.error('Please fill all required fields correctly')
      return
    }

    // If payment is enabled, just navigate to payment step (booking created during payment verify)
    if (hasPayment) {
      goNext()
      return
    }

    // No payment: create booking directly
    const bookingData = buildBookingData()
    if (!bookingData) return

    setSubmitting(true)
    try {
      const result = await api.createBooking(slug, bookingData)
      setBooking(result)
      postMessage('BOOKING_CONFIRMED', { bookingId: result.id, customerName: result.customerName, date: result.date, time: result.startTime })
      goNext()
    } catch (err: any) {
      toast.error(err.message || 'Booking failed')
    } finally {
      setSubmitting(false)
    }
  }

  // Handle successful payment: booking is returned from the verify endpoint
  const handlePaymentSuccess = (paidBooking: any) => {
    setBooking(paidBooking)
    postMessage('BOOKING_CONFIRMED', { bookingId: paidBooking.id, customerName: paidBooking.customerName, date: paidBooking.date, time: paidBooking.startTime })
    postMessage('PAYMENT_COMPLETED', { bookingId: paidBooking.id, amount: paidBooking.paymentAmount })
    goNext()
  }

  const handleWaitlist = (time: string) => {
    setWaitlistTime(time)
    setShowWaitlist(true)
  }

  if (!config) {
    return (
      <div className="max-w-md mx-auto p-6 space-y-4">
        <div className="skeleton h-8 w-3/4" />
        <div className="skeleton h-64" />
        <div className="skeleton h-10" />
      </div>
    )
  }

  const stepName = steps[currentStep]

  return (
    <div className="max-w-md mx-auto p-6 space-y-6">
      {/* Progress bar */}
      {currentStep < steps.length - 1 && (
        <div className="flex items-center gap-2">
          {steps.slice(0, -1).map((s, i) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className={`h-1.5 flex-1 rounded-full transition-colors ${
                i <= currentStep ? 'bg-primary' : 'bg-gray-200 dark:bg-gray-700'
              }`} />
            </div>
          ))}
        </div>
      )}

      {/* Step label */}
      {currentStep < steps.length - 1 && (
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{stepLabels[stepName] || stepName}</h2>
          <span className="text-xs text-gray-400">Step {currentStep + 1} of {steps.length - 1}</span>
        </div>
      )}

      {/* Step content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={stepName}
          initial={{ x: 100, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -100, opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          {stepName === 'staff-selection' && (
            <StaffSelection
              staff={config.staff}
              selectedStaff={wizard.selectedStaff}
              onSelect={(id) => { setWizard({ selectedStaff: id }); goNext() }}
            />
          )}

          {stepName === 'date-time' && (
            <DateTimePicker
              config={config}
              slug={slug}
              selectedDate={wizard.selectedDate}
              selectedTime={wizard.selectedTime}
              staffId={wizard.selectedStaff}
              isRecurring={wizard.isRecurring}
              recurringFrequency={wizard.recurringFrequency}
              recurringCount={wizard.recurringCount}
              recurringSkipDates={wizard.recurringSkipDates}
              onSelectDate={(d) => setWizard({ selectedDate: d })}
              onSelectTime={(t) => setWizard({ selectedTime: t })}
              onWaitlist={handleWaitlist}
              onToggleRecurring={(v) => setWizard({ isRecurring: v })}
              onRecurringFrequency={(f) => setWizard({ recurringFrequency: f })}
              onRecurringCount={(n) => setWizard({ recurringCount: n })}
              onSkipToggle={(d) => {
                const skips = wizard.recurringSkipDates.includes(d)
                  ? wizard.recurringSkipDates.filter((x) => x !== d)
                  : [...wizard.recurringSkipDates, d]
                setWizard({ recurringSkipDates: skips })
              }}
            />
          )}

          {stepName === 'customer-form' && (
            <CustomerForm
              fields={config.formFields}
              formData={wizard.formData}
              onChange={(fieldId, value) => {
                setWizard({ formData: { ...wizard.formData, [fieldId]: value } })
                if (showFormErrors) setShowFormErrors(false)
              }}
              onValidityChange={(isValid) => setFormValid(isValid)}
              showErrors={showFormErrors}
            />
          )}

          {stepName === 'payment' && (
            <PaymentStep
              slug={slug}
              amount={config.servicePrice || 0}
              depositAmount={config.depositAmount}
              paymentMode={config.paymentMode as 'full' | 'deposit' | 'none'}
              serviceName={config.name}
              testMode={config.razorpayTestMode}
              bookingData={buildBookingData() || {}}
              onPaymentSuccess={handlePaymentSuccess}
              onBack={goBack}
            />
          )}

          {stepName === 'confirmation' && booking && (
            <ConfirmationScreen
              booking={booking}
              businessName={config.name}
              depositPaid={config.paymentMode === 'deposit' ? config.depositAmount : null}
              remainder={config.paymentMode === 'deposit' && config.depositAmount ? (config.servicePrice || 0) - config.depositAmount : 0}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Navigation */}
      {currentStep < steps.length - 1 && stepName !== 'staff-selection' && stepName !== 'payment' && (
        <div className="flex gap-3">
          {currentStep > 0 && (
            <button onClick={goBack} className="flex-1 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800">
              Back
            </button>
          )}
          {stepName === 'date-time' && wizard.selectedTime && (
            <button onClick={goNext} className="flex-1 py-2.5 bg-primary hover:bg-primary-dark text-white rounded-lg text-sm font-medium">
              Continue
            </button>
          )}
          {stepName === 'customer-form' && (
            <button
              onClick={handleFormSubmit}
              disabled={submitting || !formValid}
              className="flex-1 py-2.5 bg-primary hover:bg-primary-dark text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Booking...' : (hasPayment ? 'Continue to Payment' : 'Confirm Booking')}
            </button>
          )}
        </div>
      )}

      {/* Waitlist sheet */}
      {showWaitlist && (
        <WaitlistSheet
          slug={slug}
          slotTime={waitlistTime}
          slotDate={wizard.selectedDate || ''}
          onClose={() => setShowWaitlist(false)}
          staffId={wizard.selectedStaff}
        />
      )}
    </div>
  )
}