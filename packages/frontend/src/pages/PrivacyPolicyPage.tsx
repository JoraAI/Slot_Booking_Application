import React from 'react'
import { Link } from 'react-router-dom'

/**
 * Public privacy policy for Google Play / App Store and web.
 * Keep this page reachable without login at `/privacy`.
 */
export const PrivacyPolicyPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-800 dark:text-gray-100">
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <Link to="/login" className="inline-flex items-center gap-2">
            <img
              src="/brand/jora-reservly-full.png"
              alt="Jora Reservly"
              className="h-10 w-auto object-contain"
            />
          </Link>
          <a
            href="mailto:admin@staffingpros.tech"
            className="text-sm text-primary hover:underline"
          >
            Contact
          </a>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10 space-y-8 text-sm leading-relaxed">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
          <p className="mt-2 text-gray-500 dark:text-gray-400">
            Jora Reservly (package <code className="text-xs">ai.jora.reservly</code>) · Last updated: 14 September 2026
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Who we are</h2>
          <p>
            Jora Reservly (“Reservly”, “we”, “us”) is a salon / service-business booking and operations
            product from <strong>Jora AI</strong> (Staffing Pros / Jora). Contact:{' '}
            <a className="text-primary underline" href="mailto:admin@staffingpros.tech">admin@staffingpros.tech</a>
            . Website: <a className="text-primary underline" href="https://jora.co.in" target="_blank" rel="noreferrer">jora.co.in</a>.
          </p>
          <p>
            This policy covers the <strong>owner Android / iOS apps</strong>, the owner web dashboard, and
            related customer booking pages that process data for businesses using Reservly.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">What the app does</h2>
          <p>
            The mobile app is an <strong>owner dashboard</strong> for managing appointments, customers,
            staff, invoices, payments settings, WhatsApp / email notifications, and subscriptions.
            Public customer booking stays on the web.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Data we collect</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong>Account data</strong> — owner name/email, password (stored hashed), optional Google
              Sign-In identifiers (web), business name, timezone, and shop settings.
            </li>
            <li>
              <strong>Business &amp; operations data</strong> — services, products, staff, working hours,
              bookings, invoices, analytics aggregates, uploaded images (logo/cover/service photos), and
              invoice PDFs needed for WhatsApp delivery.
            </li>
            <li>
              <strong>Customer data you enter or collect via booking</strong> — typically name, phone,
              email, and answers to intake forms you configure. You are the controller of your customers’
              data; we process it to provide the service.
            </li>
            <li>
              <strong>Payment data</strong> — payment amounts, statuses, and Razorpay transaction /
              refund identifiers. Card / UPI secrets are handled by Razorpay; we do not store full card
              numbers.
            </li>
            <li>
              <strong>Location</strong> — optional salon pin from device location or map search, used only
              when you set business location in Settings.
            </li>
            <li>
              <strong>Support</strong> — ticket subject/details and optional short voice notes. Voice notes
              are attached to support email and are not retained as media files in our database.
            </li>
            <li>
              <strong>Device / session</strong> — authentication tokens on the device (mobile: Preferences;
              web: session storage), and standard server logs needed to operate and secure the service.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">How we use data</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>Provide and secure the booking, invoicing, and owner dashboard features.</li>
            <li>Send booking confirmations, reminders, invoices, and owner-authored messages you request (email / WhatsApp).</li>
            <li>Process subscriptions and wallet top-ups via Razorpay.</li>
            <li>Respond to owner support requests.</li>
            <li>Improve reliability, prevent abuse, and meet legal obligations.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Sharing</h2>
          <p>We share data only as needed to run the product:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li><strong>Razorpay</strong> — payments, subscriptions, refunds.</li>
            <li><strong>WhatsApp / messaging providers</strong> (e.g. Gupshup / Meta) — when you send WhatsApp messages.</li>
            <li><strong>Email providers</strong> (e.g. Resend / SMTP) — transactional and support email.</li>
            <li><strong>Hosting / database</strong> — cloud infrastructure that stores and serves the app.</li>
          </ul>
          <p>We do not sell personal information. We do not use your data for third-party advertising.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Permissions (Android)</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li><strong>Internet</strong> — required to use the app.</li>
            <li><strong>Location</strong> — optional; used only to help set the salon location.</li>
            <li><strong>Microphone</strong> — optional; used only if you record a support voice note.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Retention &amp; deletion</h2>
          <p>
            We keep account and business data while your workspace is active. You may request deletion of
            your owner account / business data by emailing{' '}
            <a className="text-primary underline" href="mailto:admin@staffingpros.tech">admin@staffingpros.tech</a>.
            We may retain limited records required for fraud prevention, accounting, or law.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Security</h2>
          <p>
            Data is transmitted over HTTPS. Passwords are hashed. Access to owner APIs requires
            authentication. No method of transmission or storage is 100% secure; please use a strong
            unique password and protect your device.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Children</h2>
          <p>
            Reservly is intended for business owners and staff (18+). It is not directed at children under 13
            (or under 16 where applicable).
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Changes</h2>
          <p>
            We may update this policy. The “Last updated” date above will change when we do. Continued use
            after updates means you accept the revised policy.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Contact</h2>
          <p>
            Privacy questions or data requests:{' '}
            <a className="text-primary underline" href="mailto:admin@staffingpros.tech">admin@staffingpros.tech</a>
          </p>
        </section>

        <p className="pt-4 border-t border-gray-200 dark:border-gray-800 text-gray-500">
          <Link to="/login" className="text-primary underline">Back to sign in</Link>
        </p>
      </main>
    </div>
  )
}
