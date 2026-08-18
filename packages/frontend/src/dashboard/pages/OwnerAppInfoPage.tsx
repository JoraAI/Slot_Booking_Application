import React from 'react'

export const OwnerAppInfoPage: React.FC = () => {
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Reservly Owner App</h1>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-3">
        <h2 className="text-lg font-semibold">About Reservly</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Reservly helps salons and service businesses manage appointments, customer communication, reminders, staff schedules, and payments from one dashboard.
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          The same owner workflow will be available in the mobile release, optimized for quick daily operations:
          today&apos;s bookings, customer messaging, slot blocking, and payment/refund actions.
        </p>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-3">
        <h2 className="text-lg font-semibold">Planned Mobile Owner Features</h2>
        <ul className="list-disc pl-5 text-sm text-gray-600 dark:text-gray-300 space-y-1">
          <li>Home summary: today&apos;s bookings, no-shows, pending actions.</li>
          <li>One-tap customer communication (email + WhatsApp).</li>
          <li>Calendar, staff, and blocked-slot management on phone.</li>
          <li>Payment and refund visibility with alerts.</li>
          <li>Push notifications for new/cancelled bookings.</li>
        </ul>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-3">
        <h2 className="text-lg font-semibold">WhatsApp Delivery Note</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          WhatsApp automation runs through Meta Cloud API configured per salon. Message charges are billed by Meta on the sender account, not by the Reservly app runtime.
        </p>
      </div>
    </div>
  )
}
