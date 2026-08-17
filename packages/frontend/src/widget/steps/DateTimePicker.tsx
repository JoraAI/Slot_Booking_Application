import React, { useState } from 'react'
import { CalendarPicker } from '../CalendarPicker'
import { TimeSlotGrid } from '../TimeSlotGrid'
import { RecurringPreview } from '../RecurringPreview'
import { useAvailability } from '../../hooks'
import type { PublicConfig } from '../../types'

interface DateTimePickerProps {
  config: PublicConfig
  slug: string
  serviceId: string | null
  selectedDate: string | null
  selectedTime: string | null
  staffId: string | null
  isRecurring: boolean
  recurringFrequency: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY'
  recurringCount: number
  recurringSkipDates: string[]
  onSelectDate: (date: string) => void
  onSelectTime: (time: string) => void
  onWaitlist: (time: string) => void
  onToggleRecurring: (v: boolean) => void
  onRecurringFrequency: (f: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY') => void
  onRecurringCount: (n: number) => void
  onSkipToggle: (date: string) => void
}

export const DateTimePicker: React.FC<DateTimePickerProps> = ({
  config,
  slug,
  serviceId,
  selectedDate,
  selectedTime,
  staffId,
  isRecurring,
  recurringFrequency,
  recurringCount,
  recurringSkipDates,
  onSelectDate,
  onSelectTime,
  onWaitlist,
  onToggleRecurring,
  onRecurringFrequency,
  onRecurringCount,
  onSkipToggle,
}) => {
  const { availability, slots, loading } = useAvailability(slug, selectedDate, serviceId, staffId)
  const staffName = staffId ? config.staff.find((s) => s.id === staffId)?.name : null
  const selectedService = config.services.find((s) => s.id === serviceId)
  const recurringRequiresUnsupportedPayment =
    config.featureFlags.recurring && config.featureFlags.payments && config.payment.mode !== 'none'

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Select Date & Time</h3>
        {selectedService && (
          <p className="text-sm text-gray-500">
            {selectedService.name} · {selectedService.durationMinutes} min
            {selectedService.bufferMinutes > 0 ? ` + ${selectedService.bufferMinutes} min buffer` : ''}
          </p>
        )}
        {staffName && <p className="text-sm text-gray-500">Availability for {staffName}</p>}
        {(config.business.minBookingNoticeHours || 0) > 0 && (
          <p className="text-xs text-gray-500 mt-1">
            Slots can be booked from {config.business.minBookingNoticeHours} hour{config.business.minBookingNoticeHours === 1 ? '' : 's'} ahead.
          </p>
        )}
      </div>

      <CalendarPicker
        bookingWindowDays={config.business.bookingWindowDays}
        selectedDate={selectedDate}
        onSelect={onSelectDate}
        workingHours={config.workingHours}
      />

      {selectedDate && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Available Times</h4>
          <TimeSlotGrid
            slots={slots}
            selectedTime={selectedTime}
            onSelect={onSelectTime}
            showAvailableCount={config.business.showAvailableCount}
            loading={loading}
          />
          {!loading && slots.length === 0 && availability?.nextAvailable && (
            <button
              onClick={() => onSelectDate(availability.nextAvailable as string)}
              className="w-full text-sm text-primary hover:underline text-left"
            >
              No slots this day — next available: {availability.nextAvailable}. Tap to jump →
            </button>
          )}
        </div>
      )}

      {config.featureFlags.recurring && selectedTime && !recurringRequiresUnsupportedPayment && (
        <div className="space-y-3 border-t border-gray-200 dark:border-gray-700 pt-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isRecurring}
              onChange={(e) => onToggleRecurring(e.target.checked)}
              className="w-4 h-4 text-primary rounded border-gray-300 focus:ring-primary"
            />
            <span className="text-sm font-medium">Make this a recurring booking</span>
          </label>

          {isRecurring && (
            <div className="space-y-3 pl-7">
              <div className="flex gap-3">
                <select
                  value={recurringFrequency}
                  onChange={(e) => onRecurringFrequency(e.target.value as any)}
                  className="text-sm border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5 bg-white dark:bg-gray-800"
                >
                  <option value="WEEKLY">Weekly</option>
                  <option value="BIWEEKLY">Bi-weekly</option>
                  <option value="MONTHLY">Monthly</option>
                </select>
                <select
                  value={recurringCount}
                  onChange={(e) => onRecurringCount(Number(e.target.value))}
                  className="text-sm border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5 bg-white dark:bg-gray-800"
                >
                  <option value={4}>4 sessions</option>
                  <option value={8}>8 sessions</option>
                  <option value={12}>12 sessions</option>
                </select>
              </div>

              {selectedDate && (
                <RecurringPreview
                  frequency={recurringFrequency}
                  count={recurringCount}
                  startDate={selectedDate}
                  skipDates={recurringSkipDates}
                  onSkipToggle={onSkipToggle}
                />
              )}
            </div>
          )}
        </div>
      )}

      {recurringRequiresUnsupportedPayment && selectedTime && (
        <p className="text-xs text-gray-500 border-t border-gray-200 dark:border-gray-700 pt-4">
          Recurring series are unavailable while online payment is required. Book this appointment first, then choose another date.
        </p>
      )}
    </div>
  )
}