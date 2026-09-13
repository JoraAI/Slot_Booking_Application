import React from 'react'

export const OwnerAppInfoPage: React.FC = () => {
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Jora Reservly Owner App</h1>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-3">
        <h2 className="text-lg font-semibold">About Jora Reservly</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Jora Reservly helps salons and service businesses manage appointments, customer communication, reminders, staff schedules, and payments from one dashboard — powered by Jora AI.
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          The owner dashboard runs on the web and as a native Android / iOS app (Capacitor). Customer booking pages stay on the web for sharing and embeds.
        </p>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-3">
        <h2 className="text-lg font-semibold">Mobile owner app</h2>
        <ul className="list-disc pl-5 text-sm text-gray-600 dark:text-gray-300 space-y-1">
          <li>Same owner workflows as the web dashboard (bookings, staff, products, invoices, analytics, settings).</li>
          <li>Sign in with email and password (Google Sign-In is web-only).</li>
          <li>Location picker and external maps use native APIs where available.</li>
          <li>Invoices open in an in-app viewer (works in WebView).</li>
          <li>Customer public booking / manage links remain web-only.</li>
        </ul>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Build and run instructions for Android Studio and Xcode are in <code className="text-xs">MOBILE.md</code> at the repo root.
        </p>
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
