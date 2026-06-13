import React from 'react'
import { Routes, Route, Navigate, useParams } from 'react-router-dom'
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
import { useStore } from './store'

export default function App() {
  const { isAuthenticated } = useStore()

  return (
    <Routes>
      {/* Public booking widget */}
      <Route path="/:slug" element={<BookingWidget />} />
      <Route path="/b/:slug" element={<BookingWidget />} />

      {/* Owner login */}
      <Route path="/login" element={<LoginPage />} />

      {/* Owner dashboard */}
      <Route path="/dashboard/*" element={
        isAuthenticated ? <DashboardLayout /> : <Navigate to="/login" />
      }>
        <Route index element={<DashboardHome />} />
        <Route path="bookings" element={<Bookings />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="blocks" element={<BlockSlots />} />
        <Route path="waitlist" element={<WaitlistPage />} />
        <Route path="staff" element={<StaffPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="form-builder" element={<FormBuilder />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      <Route path="/" element={<Navigate to="/login" />} />
    </Routes>
  )
}

function BookingWidget() {
  const { slug } = useParams<{ slug: string }>()
  const { setConfig } = useStore()
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!slug) return
    api.getConfig(slug)
      .then((config) => {
        setConfig(config)
      })
      .catch((err) => {
        console.error('Failed to load business config:', err)
        setError('Business not found or unavailable.')
      })
  }, [slug, setConfig])

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
    </div>
  )
}
