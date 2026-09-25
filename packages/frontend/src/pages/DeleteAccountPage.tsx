import React from 'react'
import { Link } from 'react-router-dom'

/**
 * Public account-deletion instructions for Google Play Data safety.
 * Reachable without login at `/delete-account`.
 */
export const DeleteAccountPage: React.FC = () => {
  const subject = encodeURIComponent('Jora Reservly — account deletion request')
  const body = encodeURIComponent(
    [
      'Please delete my Jora Reservly owner account and associated data.',
      '',
      'Account email:',
      'Business / salon name (if known):',
      'Package: ai.jora.reservly',
      '',
      'I confirm I am the account owner and request permanent deletion.',
    ].join('\n')
  )
  const mailto = `mailto:admin@staffingpros.tech?subject=${subject}&body=${body}`

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-800 dark:text-gray-100">
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <Link to="/login" className="inline-flex items-center gap-2">
            <img
              src="/brand/jora-reservly-full.png"
              alt="Reservly"
              className="h-10 w-auto object-contain"
            />
          </Link>
          <a href="mailto:admin@staffingpros.tech" className="text-sm text-primary hover:underline">
            Contact
          </a>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10 space-y-8 text-sm leading-relaxed">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Delete your Jora Reservly account</h1>
          <p className="mt-2 text-gray-500 dark:text-gray-400">
            Jora Reservly is a product of <strong>StaffingPros</strong> (Google Play package{' '}
            <code className="text-xs">ai.jora.reservly</code>) · Last updated: 14 September 2026
          </p>
        </div>

        <section className="space-y-3 rounded-xl border border-primary/20 bg-primary-light/40 dark:bg-primary/10 p-5">
          <h2 className="text-lg font-semibold">How to request deletion</h2>
          <ol className="list-decimal pl-5 space-y-2">
            <li>
              Email us from the same address you use to sign in to Jora Reservly:{' '}
              <a className="text-primary underline font-medium" href={mailto}>admin@staffingpros.tech</a>
            </li>
            <li>
              Use subject line: <strong>Jora Reservly — account deletion request</strong>
            </li>
            <li>
              Include your account email and business / salon name so we can verify ownership.
            </li>
            <li>
              We will confirm by email and delete the account and associated data within{' '}
              <strong>30 days</strong> (usually sooner).
            </li>
          </ol>
          <p>
            <a
              className="inline-flex items-center justify-center px-4 py-2.5 rounded-lg bg-primary text-white font-medium hover:bg-primary-dark"
              href={mailto}
            >
              Request account deletion by email
            </a>
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">What we delete</h2>
          <p>When deletion is completed, we remove or irreversibly anonymize data tied to your owner account and business workspace, including:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Owner account credentials and profile (email, name, auth tokens)</li>
            <li>Business settings, branding, services, products, staff, working hours</li>
            <li>Bookings, customers, invoices, and related operational records for that workspace</li>
            <li>Uploaded media for that business (logos, covers, service photos, invoice PDFs)</li>
            <li>Notification preferences and support tickets associated with the account</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">What we may keep</h2>
          <p>We may retain limited information where required for legal, security, tax, or fraud-prevention purposes, for example:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Payment / subscription transaction identifiers and amounts processed via Razorpay (as required for accounting and dispute handling)</li>
            <li>Records needed to comply with law or enforce our terms</li>
            <li>Aggregated analytics that no longer identify you or your customers</li>
          </ul>
          <p>
            Retained records are kept only as long as needed for those purposes, then deleted or anonymized.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Customer data</h2>
          <p>
            Customer booking details are stored as part of your business workspace. Deleting your owner account
            removes that workspace data from Jora Reservly. If you separately store customer data outside the app,
            you remain responsible for that data.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Questions</h2>
          <p>
            Privacy Policy:{' '}
            <Link className="text-primary underline" to="/privacy">/privacy</Link>
            <br />
            Contact:{' '}
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
