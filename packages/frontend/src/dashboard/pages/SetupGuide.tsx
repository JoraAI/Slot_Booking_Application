import React from 'react'
import { Link } from 'react-router-dom'

export const SetupGuide: React.FC = () => (
  <div className="max-w-3xl space-y-8">
    <div>
      <h1 className="text-2xl font-bold">Setup Guide</h1>
      <p className="text-sm text-gray-500">Configure customer contacts, notifications, and payment settlement safely.</p>
      <p className="text-sm mt-2">
        Need help? Contact <a className="text-primary underline" href="mailto:admin@staffingpros.tech">admin@staffingpros.tech</a>.
      </p>
    </div>

    <GuideSection id="customers" title="Customer phonebook">
      <ol className="list-decimal pl-5 space-y-2">
        <li>Open <Link className="text-primary underline" to="/dashboard/customers">Customers</Link>.</li>
        <li>Existing booking customers are added automatically and new bookings update the matching phone-number contact.</li>
        <li>Use Add, Edit, or Delete to maintain manual contacts. Deleting a contact never deletes bookings.</li>
        <li>
          Select Notify on a customer, or open <Link className="text-primary underline" to="/dashboard/notifications">Notifications</Link> and use
          <strong> Send a custom message</strong>. Enter the collected email and/or WhatsApp number, write the
          message, and send.
        </li>
      </ol>
    </GuideSection>

    <GuideSection id="notifications" title="Email and WhatsApp notifications">
      <ol className="list-decimal pl-5 space-y-2">
        <li>
          In <Link className="text-primary underline" to="/dashboard/settings">Settings → Owner Contact</Link>,
          enter the owner email and WhatsApp number where you want alerts. Changing owner email also
          changes the dashboard login email.
        </li>
        <li>
          On the same page, open <strong>Email &amp; WhatsApp delivery</strong>. These are <em>your</em>
          mailbox and Twilio account — they are stored in the database, encrypted, and never shown
          again after save. Leave a password/token field blank to keep the saved value.
        </li>
        <li>
          <strong>Email:</strong> SMTP host (Gmail: <code>smtp.gmail.com</code>), port <code>587</code>
          (leave TLS/port 465 unchecked unless your provider requires it), SMTP username (the From
          address), SMTP password, and From name (usually the salon name). For Gmail, create an
          <a className="text-primary underline" href="https://support.google.com/accounts/answer/185833" target="_blank" rel="noopener noreferrer"> App Password</a>
          — do not paste your dashboard password or normal mailbox password.
        </li>
        <li>
          <strong>WhatsApp:</strong> Twilio Account SID, Auth Token, and WhatsApp From
          (for example <code>whatsapp:+14155238886</code>). The From value must be a Twilio-approved
          WhatsApp sender; Meta will not deliver from an arbitrary personal number. Optional SMS From
          is only needed if you enable SMS OTP for booking management.
        </li>
        <li>
          Tick which channels to use (email customers, email me, WhatsApp customers, WhatsApp me),
          then Save All.
        </li>
        <li>
          Open <Link className="text-primary underline" to="/dashboard/notifications">Notifications</Link>,
          confirm Channel Readiness is green, and send a test. The test email goes to the owner email
          from your SMTP username; the test WhatsApp goes to the owner WhatsApp number from your
          Twilio sender.
        </li>
        <li>
          To message a customer, use <strong>Send a custom message</strong> on that same page: pick a
          saved customer or type the collected email / WhatsApp number, write the message, and send.
          Use <strong>Send to all customers</strong> to email everyone with a valid address and WhatsApp
          everyone with a valid number. Anyone who cannot be reached is listed on the page and emailed
          to you. History appears below the form.
        </li>
      </ol>
      <p className="text-amber-700 dark:text-amber-300 mt-3">
        Emails are sent from your SMTP username, with owner email as Reply-To. WhatsApp is sent from
        your approved Twilio sender; the owner WhatsApp number is included as the customer contact.
        Messages outside Meta's customer-service window may require an approved content template.
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
      <p className="mt-3">
        On a mobile browser, Razorpay UPI Intent automatically detects and presents installed apps
        such as Google Pay, PhonePe, Paytm, and BHIM first. The customer must tap their preferred
        app before the operating system opens it; browsers cannot safely launch an arbitrary
        payment app without that user choice.
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
