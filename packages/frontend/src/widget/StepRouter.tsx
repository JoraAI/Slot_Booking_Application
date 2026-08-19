import React, { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '../store'
import { api } from '../lib/api'
import { usePostMessage } from '../hooks'
import { ServiceSelection } from './steps/ServiceSelection'
import { StaffSelection } from './steps/StaffSelection'
import { DateTimePicker } from './steps/DateTimePicker'
import { CustomerForm, validateCustomerForm } from './steps/CustomerForm'
import { PaymentStep } from './steps/PaymentStep'
import { ConfirmationScreen } from './steps/ConfirmationScreen'
import { WaitlistSheet } from './WaitlistSheet'
import { BusyOverlay } from '../components/BusyOverlay'
import type { Booking, BookingSource, FormField } from '../types'
import toast from 'react-hot-toast'

const stepLabels: Record<string, string> = {
  'service-selection': 'Service',
  'staff-selection': 'Staff',
  'date-time': 'Date & Time',
  'customer-form': 'Details',
  'payment': 'Payment',
  'confirmation': 'Confirmed',
}

/** Map dynamic form field values onto the booking contact fields. */
function extractCustomerContact(
  fields: FormField[],
  formData: Record<string, string | boolean | number>
): { customerName: string; customerPhone: string; customerEmail: string | null } {
  const asString = (value: string | boolean | number | undefined) =>
    typeof value === 'string' ? value.trim() : value != null ? String(value).trim() : ''

  const byType = (type: FormField['fieldType']) =>
    fields.find((field) => field.fieldType === type && field.visible)

  const byLabel = (matcher: RegExp) =>
    fields.find((field) => field.visible && matcher.test(field.label))

  const nameField =
    byLabel(/\b(full\s*)?name\b/i) ||
    fields.find((field) => field.visible && field.required && field.fieldType === 'text') ||
    fields.find((field) => field.visible && field.fieldType === 'text')

  const phoneField = byType('tel') || byLabel(/\bphone|mobile|whatsapp\b/i)
  const emailField = byType('email') || byLabel(/\bemail\b/i)

  const customerName = asString(nameField ? formData[nameField.id] : formData.name)
  const customerPhone = asString(phoneField ? formData[phoneField.id] : formData.phone)
  const customerEmail = asString(emailField ? formData[emailField.id] : formData.email) || null

  return { customerName, customerPhone, customerEmail }
}

/** Normalize booking source from URL/embed context once. */
function detectSource(): BookingSource {
  try {
    const params = new URLSearchParams(window.location.search)
    // Explicit, normalized source wins. QR is attributed ONLY when the URL
    // explicitly carries src=qr / source=qr.
    const raw = params.get('src') || params.get('source')
    if (raw) {
      const upper = raw.toUpperCase()
      if (['QR', 'EMBED', 'WIDGET', 'DIRECT'].includes(upper)) return upper as BookingSource
    }
    // Embed detection comes before any path heuristic. A plain /b/{publicCode}
    // URL with no source param is DIRECT, never QR.
    if (window.parent !== window || params.get('embed') === 'true' || params.get('embed') === '1') return 'EMBED'
  } catch {
    /* ignore */
  }
  return 'DIRECT'
}

export const StepRouter: React.FC = () => {
  const { publicConfig, wizard, setWizard, resetWizard } = useStore()
  const config = publicConfig
  const postMessage = usePostMessage()
  const [booking, setBooking] = useState<Booking | null>(null)
  const [showWaitlist, setShowWaitlist] = useState(false)
  const [waitlistTime, setWaitlistTime] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showFormErrors, setShowFormErrors] = useState(false)
  const [formValid, setFormValid] = useState(false)

  const slug = config?.business.slug || ''

  // Reset the entire wizard whenever the resolved business changes (tenant
  // switch), but never on ordinary rerenders of the same business.
  const lastPublicCodeRef = React.useRef<string | null>(null)
  useEffect(() => {
    if (!config) return
    if (lastPublicCodeRef.current !== config.business.publicCode) {
      lastPublicCodeRef.current = config.business.publicCode
      resetWizard()
    }
  }, [config, resetWizard])

  // Normalize source once from URL/embed context
  useEffect(() => {
    if (config && wizard.source === 'DIRECT') {
      const source = detectSource()
      if (source !== 'DIRECT') setWizard({ source })
    }
  }, [config, wizard.source, setWizard])

  const selectedService = useMemo(
    () => config?.services.find((s) => s.id === wizard.selectedServiceId) || null,
    [config, wizard.selectedServiceId]
  )

  const steps = useMemo(() => {
    if (!config) return []
    const s: string[] = ['service-selection']
    if (config.featureFlags.multiStaff && selectedService?.resourceMode === 'STAFF_BASED') s.push('staff-selection')
    s.push('date-time')
    s.push('customer-form')
    if (config.featureFlags.payments && config.payment.mode !== 'none') s.push('payment')
    s.push('confirmation')
    return s
  }, [config, selectedService])

  const currentStep = wizard.currentStep

  // Reset dependent selections when a parent changes
  const selectService = (id: string) => {
    const reset = {
      selectedServiceId: id,
      selectedStaff: null,
      selectedDate: null,
      selectedTime: null,
      displayedPricing: null,
      paymentOrderId: null,
      paymentAmount: null,
      isRecurring: false,
    }
    if (id === wizard.selectedServiceId) {
      setWizard({ ...reset, selectedServiceId: null })
    } else {
      const service = config?.services.find((s) => s.id === id)
      setWizard({ ...reset, displayedPricing: service?.displayedPricing || null })
    }
  }

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

  const hasPayment = config?.featureFlags.payments && config?.payment.mode !== 'none'

  // Build booking data from wizard state (server derives duration/price/source)
  const buildBookingData = () => {
    if (!config || !wizard.selectedServiceId || !wizard.selectedDate || !wizard.selectedTime) return null

    const contact = extractCustomerContact(config.formFields, wizard.formData)

    return {
      date: wizard.selectedDate,
      startTime: wizard.selectedTime,
      serviceId: wizard.selectedServiceId,
      formData: wizard.formData,
      customerName: contact.customerName,
      customerPhone: contact.customerPhone,
      customerEmail: contact.customerEmail,
      staffId: wizard.selectedStaff,
      isRecurring: wizard.isRecurring,
      recurringFrequency: wizard.isRecurring ? wizard.recurringFrequency : undefined,
      recurringCount: wizard.isRecurring ? wizard.recurringCount : undefined,
      recurringSkipDates: wizard.isRecurring ? wizard.recurringSkipDates : undefined,
      source: wizard.source,
    }
  }

  const handleFormSubmit = async () => {
    if (!config || !wizard.selectedDate || !wizard.selectedTime) return

    const { isValid } = validateCustomerForm(config.formFields, wizard.formData)
    if (!isValid) {
      setShowFormErrors(true)
      toast.error('Please fill all required fields correctly')
      return
    }

    if (hasPayment) {
      goNext()
      return
    }

    const bookingData = buildBookingData()
    if (!bookingData) return

    setSubmitting(true)
    try {
      if (wizard.isRecurring) {
        const result = await api.createRecurringBooking(slug, {
          startDate: bookingData.date,
          startTime: bookingData.startTime,
          serviceId: bookingData.serviceId,
          staffId: bookingData.staffId,
          customerName: bookingData.customerName,
          customerPhone: bookingData.customerPhone,
          customerEmail: bookingData.customerEmail,
          formData: bookingData.formData,
          frequency: wizard.recurringFrequency.toLowerCase(),
          count: wizard.recurringCount,
          skipDates: wizard.recurringSkipDates,
          source: bookingData.source,
        })
        const first = result.bookings[0]
        if (!first) {
          const reason = result.conflicts[0]?.reason || 'No dates in this series are available'
          throw new Error(reason)
        }
        // Show the confirmation before any side effect: the booking is already
        // committed server-side, so nothing after this may block navigation.
        setBooking(first)
        goNext()
        postMessage('BOOKING_CONFIRMED', {
          bookingId: first.id,
          customerName: first.customerName,
          date: first.date,
          time: first.startTime,
          recurringGroupId: result.recurringGroupId,
          bookedCount: result.bookings.length,
        })
        if (result.conflicts.length > 0) {
          toast.success(`${result.bookings.length} appointments booked; ${result.conflicts.length} unavailable dates skipped`)
        }
        return
      }

      const result = await api.createBooking(slug, bookingData)
      setBooking(result)
      goNext()
      postMessage('BOOKING_CONFIRMED', { bookingId: result.id, customerName: result.customerName, date: result.date, time: result.startTime })
    } catch (err: any) {
      toast.error(err.message || 'Booking failed')
    } finally {
      setSubmitting(false)
    }
  }

  const handlePaymentSuccess = (paidBooking: any) => {
    setBooking(paidBooking)
    goNext()
    postMessage('BOOKING_CONFIRMED', { bookingId: paidBooking.id, customerName: paidBooking.customerName, date: paidBooking.date, time: paidBooking.startTime })
    postMessage('PAYMENT_COMPLETED', { bookingId: paidBooking.id, amount: paidBooking.paymentAmount })
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
  const pricing = wizard.displayedPricing

  return (
    <div className="relative max-w-md mx-auto p-6 space-y-6">
      <BusyOverlay show={submitting} message="Confirming your booking…" />

      {/* Branding header */}
      <div className="text-center pt-2">
        {config.business.branding.logoUrl && (
          <img src={config.business.branding.logoUrl} alt={config.business.name} className="w-14 h-14 rounded-full object-cover mx-auto mb-2" />
        )}
        <h1 className="text-xl font-bold">{config.business.name}</h1>
        {config.business.description && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{config.business.description}</p>
        )}
      </div>

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
          {stepName === 'service-selection' && (
            <ServiceSelection
              config={config}
              selectedCategoryId={wizard.selectedCategoryId}
              selectedServiceId={wizard.selectedServiceId}
              onSelectCategory={(id) => {
                setWizard({ selectedCategoryId: id || null, selectedServiceId: null, selectedStaff: null, selectedDate: null, selectedTime: null, displayedPricing: null })
              }}
              onSelectService={(id) => { selectService(id); goNext() }}
            />
          )}

          {stepName === 'staff-selection' && selectedService && (
            <StaffSelection
              staff={config.staff.filter((s) => (selectedService.assignedStaffIds || []).includes(s.id))}
              selectedStaff={wizard.selectedStaff}
              onSelect={(id) => {
                setWizard({ selectedStaff: id, selectedTime: null })
                goNext()
              }}
            />
          )}

          {stepName === 'date-time' && (
            <DateTimePicker
              config={config}
              slug={slug}
              serviceId={wizard.selectedServiceId}
              selectedDate={wizard.selectedDate}
              selectedTime={wizard.selectedTime}
              staffId={wizard.selectedStaff}
              isRecurring={wizard.isRecurring}
              recurringFrequency={wizard.recurringFrequency}
              recurringCount={wizard.recurringCount}
              recurringSkipDates={wizard.recurringSkipDates}
              onSelectDate={(d) => setWizard({ selectedDate: d, selectedTime: null })}
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

          {stepName === 'payment' && selectedService && (
            <PaymentStep
              slug={slug}
              amount={pricing?.finalPrice ?? selectedService.price}
              discountAmount={pricing?.discountAmount || null}
              discountLabel={pricing?.discountLabel || null}
              depositAmount={config.payment.depositAmount}
              paymentMode={config.payment.mode as 'full' | 'deposit' | 'none'}
              serviceName={selectedService.name}
              serviceId={selectedService.id}
              date={wizard.selectedDate || ''}
              startTime={wizard.selectedTime || ''}
              testMode={config.payment.testMode}
              businessName={config.business.name}
              bookingData={buildBookingData() || {}}
              onPaymentSuccess={handlePaymentSuccess}
              onBack={goBack}
            />
          )}

          {stepName === 'confirmation' && booking && (
            <ConfirmationScreen
              booking={{
                ...booking,
                serviceNameSnapshot: booking.serviceNameSnapshot || selectedService?.name || null,
              }}
              businessName={config.business.name}
              location={config.business.location}
              depositPaid={config.payment.mode === 'deposit' ? config.payment.depositAmount : null}
              remainder={config.payment.mode === 'deposit' && config.payment.depositAmount ? (pricing?.finalPrice ?? booking.finalPrice ?? 0) - config.payment.depositAmount : 0}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Navigation */}
      {currentStep < steps.length - 1 && stepName !== 'service-selection' && stepName !== 'staff-selection' && stepName !== 'payment' && (
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
          serviceId={wizard.selectedServiceId}
        />
      )}
    </div>
  )
}
