import React, { useState, useEffect } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { api } from '../lib/api'
import { FeatureGate } from '../widget/FeatureGate'
import { JoraPoweredBy } from '../components/JoraPoweredBy'

const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: '📊', end: true },
  { path: '/dashboard/bookings', label: 'Bookings', icon: '📋' },
  { path: '/dashboard/customers', label: 'Customers', icon: '📒' },
  { path: '/dashboard/calendar', label: 'Calendar', icon: '📅' },
  { path: '/dashboard/services', label: 'Services', icon: '💇' },
  { path: '/dashboard/products', label: 'Products', icon: '🛍️' },
  { path: '/dashboard/invoices', label: 'Invoices', icon: '🧾' },
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
  { path: '/dashboard/subscription', label: 'Subscription', icon: '🧾', ownerOnly: true },
  { path: '/dashboard/app-info', label: 'Owner App', icon: '📱' },
  { path: '/dashboard/support', label: 'Support', icon: '🆘' },
  { path: '/dashboard/setup-guide', label: 'Setup Guide', icon: '❓' },
]

export const DashboardLayout: React.FC = () => {
  const { config, setConfig, setIsAuthenticated } = useStore()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [addingShop, setAddingShop] = useState(false)
  const [newShopName, setNewShopName] = useState('')

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
    setConfig(null as any)
    navigate('/login')
  }

  const handleSwitchShop = async (businessId: string) => {
    if (!businessId || businessId === config?.id || switching) return
    setSwitching(true)
    try {
      const res = await api.switchShop(businessId)
      api.setToken(res.token)
      const me = await api.getOwnerMe()
      setConfig(me)
      navigate('/dashboard')
    } catch (e: any) {
      alert(e?.message || 'Could not switch shop')
    } finally {
      setSwitching(false)
    }
  }

  const handleAddShop = async () => {
    const name = newShopName.trim()
    if (name.length < 2) return
    setAddingShop(true)
    try {
      const res = await api.createShop({ name, copyHoursFromPrimary: true })
      api.setToken(res.token)
      setNewShopName('')
      const me = await api.getOwnerMe()
      setConfig(me)
      navigate('/dashboard')
    } catch (e: any) {
      alert(e?.message || 'Could not create shop')
    } finally {
      setAddingShop(false)
    }
  }

  const role = config?.role || 'OWNER'
  const shops = config?.shops || []
  const isOwner = role === 'OWNER'

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950">
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 transform transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex shrink-0 items-center gap-2.5 px-5 py-4 border-b border-gray-200 dark:border-gray-800 safe-top">
          <img
            src="/brand/jora-reservly-mark-white.png"
            alt=""
            className="h-9 w-9 object-contain rounded-lg bg-white"
          />
          <div className="min-w-0 leading-tight">
            <p className="font-bold text-[15px] truncate">Jora Reservly</p>
            <p className="text-[10px] text-gray-400 truncate">Powered by Jora AI</p>
          </div>
        </div>

        {shops.length > 0 && (
          <div className="shrink-0 px-3 pt-3 pb-1 border-b border-gray-100 dark:border-gray-800 space-y-2">
            <label className="block text-[11px] uppercase tracking-wide text-gray-400 px-1">Shop</label>
            <select
              className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5"
              value={config?.id || ''}
              disabled={switching || shops.length < 2}
              onChange={(e) => handleSwitchShop(e.target.value)}
            >
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.isPrimary ? ' (Primary)' : ''}
                </option>
              ))}
            </select>
            {isOwner && (
              <div className="flex gap-1">
                <input
                  className="flex-1 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1"
                  placeholder="New shop name"
                  value={newShopName}
                  onChange={(e) => setNewShopName(e.target.value)}
                />
                <button
                  type="button"
                  disabled={addingShop || newShopName.trim().length < 2}
                  onClick={handleAddShop}
                  className="text-xs px-2 py-1 rounded-md bg-primary text-white disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            )}
            <p className="text-[11px] text-gray-400 px-1">{role === 'MANAGER' ? 'Manager' : 'Owner'}</p>
          </div>
        )}

        <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-1">
          {navItems.map((item) => {
            if ((item as any).ownerOnly && !isOwner) return null
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
        <div className="shrink-0 p-3 border-t border-gray-200 dark:border-gray-800">
          <button onClick={handleLogout} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
            <span>🚪</span>
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 lg:ml-64 overflow-y-auto">
        <div className="p-4 lg:p-8 flex flex-col min-h-full safe-top">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden mb-4 p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800">
            ☰
          </button>
          <div className="flex-1">
            <Outlet />
          </div>
          <JoraPoweredBy />
        </div>
      </main>

      {/* Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}
    </div>
  )
}
