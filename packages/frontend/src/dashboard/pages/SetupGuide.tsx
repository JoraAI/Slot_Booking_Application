import React from 'react'
import { Link } from 'react-router-dom'

export const SetupGuide: React.FC = () => (
  <div className="max-w-3xl space-y-8">
    <div>
      <h1 className="text-2xl font-bold">Setup Guide</h1>
      <p className="text-sm text-gray-500">Configure customer contacts, notifications, and payment settlement safely.</p>
    </div>

    <GuideSection id="customers" title="Customer phonebook">
      <ol className="list-decimal pl-5 space-y-2">
        <li>Open <Link className="text-primary underline" to="/dashboard/customers">Customers</Link>.</li>
        <li>Existing booking customers are added automatically and new bookings update the matching phone-number contact.</li>
        <li>Use Add, Edit, or Delete to maintain manual contacts. Deleting a contact never deletes bookings.</li>
        <li>Select Notify to compose an email, WhatsApp message, or both.</li>
      </ol>
    </GuideSection>

    <GuideSection id="notifications" title="Email and WhatsApp notifications">
      <ol className="list-decimal pl-5 space-y-2">
        <li>In <Link className="text-primary underline" to="/dashboard/settings">Settings</Link>, enter the owner email and WhatsApp number.</li>
        <li>
          On the backend host, configure <code>SMTP_USER</code>, <code>SMTP_PASS</code>, and optionally
          <code> SMTP_HOST</code>, <code>SMTP_PORT</code>, <code>SMTP_FROM_NAME</code>.
        </li>
        <li>
          For WhatsApp, configure <code>TWILIO_ACCOUNT_SID</code>, <code>TWILIO_AUTH_TOKEN</code>, and
          <code> TWILIO_WHATSAPP_FROM</code>. The From value must be a Twilio-approved WhatsApp sender.
        </li>
        <li>Redeploy the backend after changing environment variables.</li>
        <li>Open <Link className="text-primary underline" to="/dashboard/notifications">Notifications</Link> and use Send Test Notification.</li>
      </ol>
      <p className="text-amber-700 dark:text-amber-300 mt-3">
        Email is sent by the configured SMTP account with the owner email as Reply-To. WhatsApp cannot
        technically be sent from an arbitrary owner number; Twilio/Meta requires an approved sender.
        The owner WhatsApp is included as the customer contact. WhatsApp messages outside Meta's
        customer-service window may require an approved content template.
      </p>
    </GuideSection>

    <GuideSection id="payments" title="Razorpay payments and destination account">
      <ol className="list-decimal pl-5 space-y-2">
        <li>Create or sign in to the owner's Razorpay account and complete KYC.</li>
        <li>In Razorpay, add and verify the bank account where settlements should arrive.</li>
        <li>From Razorpay Dashboard → Account &amp; Settings → API Keys, generate live Key ID and Key Secret.</li>
        <li>In <Link className="text-primary underline" to="/dashboard/settings">Settings → Payment Settings</Link>, enable Payments, select full/deposit mode, disable Test Mode, and enter those keys.</li>
        <li>Save, then make a small real payment and verify it in both Reservly and the Razorpay dashboard.</li>
      </ol>
      <p className="text-amber-700 dark:text-amber-300 mt-3">
        There is no destination UPI-ID field by design. Razorpay checkout payments belong to the
        account identified by the API keys and settle to that account's verified bank account.
        Entering an arbitrary UPI ID here would not control settlement and would be misleading.
      </p>
    </GuideSection>
  </div>
)

function GuideSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
      <h2 className="text-lg font-semibold mb-3">{title}</h2>
      <div className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{children}</div>
    </section>
  )
}
