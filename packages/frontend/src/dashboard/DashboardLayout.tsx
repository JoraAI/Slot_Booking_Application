import React, { useState, useEffect } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { api } from '../lib/api'
import { FeatureGate } from '../widget/FeatureGate'

const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: '📊', end: true },
  { path: '/dashboard/bookings', label: 'Bookings', icon: '📋' },
  { path: '/dashboard/calendar', label: 'Calendar', icon: '📅' },
  { path: '/dashboard/services', label: 'Services', icon: '💇' },
  { path: '/dashboard/blocks', label: 'Block Slots', icon: '🚫' },
  { path: '/dashboard/waitlist', label: 'Waitlist', icon: '⏳', feature: 'waitlist' as const },
  { path: '/dashboard/staff', label: 'Staff', icon: '👥', feature: 'multiStaff' as const },
  { path: '/dashboard/payments', label: 'Payments', icon: '💳', feature: 'payments' as const },
  { path: '/dashboard/analytics', label: 'Analytics', icon: '📈' },
  { path: '/dashboard/form-builder', label: 'Form Builder', icon: '📝' },
  { path: '/dashboard/page-builder', label: 'Public Page', icon: '🎨' },
  { path: '/dashboard/qr-code', label: 'QR Code', icon: '🔳' },
  { path: '/dashboard/notifications', label: 'Notifications', icon: '🔔' },
  { path: '/dashboard/settings', label: 'Settings', icon: '⚙️' },
]

export const DashboardLayout: React.FC = () => {
  const { config, setConfig, setIsAuthenticated } = useStore()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Fetch business config on mount so all dashboard pages have access
  useEffect(() => {
    if (!config) {
      api.getOwnerMe().then(setConfig).catch(() => {
        // If fetch fails (e.g. token expired), redirect to login
        api.setToken(null)
        setIsAuthenticated(false)
        navigate('/login')
      })
    }
  }, [])

  const handleLogout = () => {
    api.setToken(null)
    setIsAuthenticated(false)
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950">
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 transform transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center gap-2 px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-white font-bold text-sm">R</div>
          <span className="font-bold text-lg">Reservly</span>
        </div>
        <nav className="p-3 space-y-1 overflow-y-auto h-[calc(100vh-120px)]">
          {navItems.map((item) => {
            const content = (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.end}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-primary-light dark:bg-primary/20 text-primary font-medium'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`
                }
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            )
            if (item.feature) {
              return <FeatureGate key={item.path} feature={item.feature}>{content}</FeatureGate>
            }
            return content
          })}
        </nav>
        <div className="p-3 border-t border-gray-200 dark:border-gray-800">
          <button onClick={handleLogout} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
            <span>🚪</span>
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 lg:ml-64 overflow-y-auto">
        <div className="p-4 lg:p-8">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden mb-4 p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800">
            ☰
          </button>
          <Outlet />
        </div>
      </main>

      {/* Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}
    </div>
  )
}