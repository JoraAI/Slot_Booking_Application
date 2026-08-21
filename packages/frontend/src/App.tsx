import React from 'react'
import { Routes, Route, Navigate, useParams, useNavigate } from 'react-router-dom'
import { api } from './lib/api'
import { StepRouter } from './widget/StepRouter'
import { DashboardLayout } from './dashboard/DashboardLayout'
import { DashboardHome } from './dashboard/pages/DashboardHome'
import { Bookings } from './dashboard/pages/Bookings'
import { CalendarPage } from './dashboard/pages/Calendar'
import { BlockSlots } from './dashboard/pages/BlockSlots'
import { WaitlistPage } from './dashboard/pages/Waitlist'
import { StaffPage } from './dashboard/pages/Staff'
import { PaymentsPage } from './dashboard/pages/Payments'
import { Analytics } from './dashboard/pages/Analytics'
import { FormBuilder } from './dashboard/pages/FormBuilder'
import { Notifications } from './dashboard/pages/Notifications'
import { Settings } from './dashboard/pages/Settings'
import { LoginPage } from './dashboard/pages/LoginPage'
import { ServicesPage } from './dashboard/pages/ServicesPage'
import { PageBuilder } from './dashboard/pages/PageBuilder'
import { QRCodePage } from './dashboard/pages/QRCodePage'
import { CustomersPage } from './dashboard/pages/Customers'
import { SetupGuide } from './dashboard/pages/SetupGuide'
import { SubscriptionPage } from './dashboard/pages/SubscriptionPage'
import { OwnerAppInfoPage } from './dashboard/pages/OwnerAppInfoPage'
import { useStore } from './store'
import { useEmbedMode } from './hooks'
import { PageSections } from './widget/PageSections'
import { ManageBookingPage } from './widget/ManageBookingPage'

export default function App() {
  const { isAuthenticated } = useStore()

  return (
    <Routes>
      {/* Public booking widget */}
      <Route path="/:slug" element={<BookingWidget />} />
      <Route path="/b/:slug" element={<BookingWidget />} />

      {/* Customer booking management (token + optional OTP) */}
      <Route path="/:slug/bookings/:bookingId/manage" element={<ManageBookingPage />} />
      <Route path="/b/:slug/bookings/:bookingId/manage" element={<ManageBookingPage />} />

      {/* Owner login */}
      <Route path="/login" element={<LoginPage />} />

      {/* Owner dashboard */}
      <Route path="/dashboard/*" element={
        isAuthenticated ? <DashboardLayout /> : <Navigate to="/login" />
      }>
        <Route index element={<DashboardHome />} />
        <Route path="bookings" element={<Bookings />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="blocks" element={<BlockSlots />} />
        <Route path="waitlist" element={<WaitlistPage />} />
        <Route path="staff" element={<StaffPage />} />
        <Route path="services" element={<ServicesPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="form-builder" element={<FormBuilder />} />
        <Route path="page-builder" element={<PageBuilder />} />
        <Route path="qr-code" element={<QRCodePage />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="settings" element={<Settings />} />
        <Route path="subscription" element={<SubscriptionPage />} />
        <Route path="app-info" element={<OwnerAppInfoPage />} />
        <Route path="setup-guide" element={<SetupGuide />} />
      </Route>

      <Route path="/" element={<Navigate to="/login" />} />
    </Routes>
  )
}

function BookingWidget() {
  const { slug } = useParams<{ slug: string }>()
  const { publicConfig, setPublicConfig } = useStore()
  const isEmbedded = useEmbedMode()
  const [error, setError] = React.useState<string | null>(null)
  const navigate = useNavigate()
  const redirectedRef = React.useRef(false)

  React.useEffect(() => {
    if (!slug) return
    api.getConfig(slug)
      .then((config) => {
        setPublicConfig(config)
        // Legacy slug URLs redirect to the canonical opaque-code URL,
        // preserving query params such as ?src=qr
        const canonicalPath = `/b/${config.business.publicCode}`
        if (window.location.pathname !== canonicalPath && !redirectedRef.current) {
          redirectedRef.current = true
          navigate(canonicalPath + window.location.search, { replace: true })
        }
        // Apply business branding colors as CSS custom properties
        const { primaryColor, secondaryColor, accentColor } = config.business.branding
        if (primaryColor) document.documentElement.style.setProperty('--color-primary', primaryColor)
        if (secondaryColor) document.documentElement.style.setProperty('--color-secondary', secondaryColor)
        if (accentColor) document.documentElement.style.setProperty('--color-accent', accentColor)
        document.title = config.business.name
      })
      .catch((err) => {
        console.error('Failed to load business config:', err)
        setError('Business not found or unavailable.')
      })
  }, [slug, setPublicConfig, navigate])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-center p-8">
          <div className="text-4xl mb-4">😕</div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-200 mb-2">Business Not Found</h1>
          <p className="text-gray-500 dark:text-gray-400">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary-light to-white dark:from-gray-900 dark:to-gray-950">
      <StepRouter />
      {/* Standalone public page shows the owner-configured PageSections;
          embed mode stays compact (booking only) and omits them. */}
      {!isEmbedded && publicConfig && (
        <PageSections
          sections={publicConfig.pageSections}
          services={publicConfig.services}
          workingHours={publicConfig.workingHours}
          location={publicConfig.business.location}
        />
      )}
    </div>
  )
}
