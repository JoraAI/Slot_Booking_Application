import React, { useState, useEffect, useCallback } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { api, ApiError } from '../lib/api'
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
  const [copyCatalog, setCopyCatalog] = useState(false)
  const [copyFromShopId, setCopyFromShopId] = useState('')
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [loadingSession, setLoadingSession] = useState(!config)

  const forceLogout = useCallback(() => {
    api.setToken(null)
    setIsAuthenticated(false)
    setConfig(null as any)
    navigate('/login')
  }, [navigate, setConfig, setIsAuthenticated])

  const loadSession = useCallback(async () => {
    setLoadingSession(true)
    setSessionError(null)
    try {
      const me = await api.getOwnerMe()
      setConfig(me)
      setSessionError(null)
    } catch (err) {
      // Network / cold-start / 5xx must NOT wipe the stored token — that caused
      // repeated Android logouts when the API was briefly unreachable.
      if (err instanceof ApiError && err.status === 401) {
        forceLogout()
        return
      }
      const message = err instanceof Error ? err.message : 'Could not load your shop'
      setSessionError(message)
    } finally {
      setLoadingSession(false)
    }
  }, [forceLogout, setConfig])

  // Fetch business config on mount so all dashboard pages have access
  useEffect(() => {
    if (!config) void loadSession()
    else setLoadingSession(false)
    // Mount-only: avoid re-fetch loops when config is set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleLogout = () => {
    forceLogout()
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
    if (copyCatalog && !copyFromShopId) {
      alert('Select a shop to copy items from, or turn off prefill')
      return
    }
    setAddingShop(true)
    try {
      const res = await api.createShop({
        name,
        copyHoursFromPrimary: !copyCatalog,
        copyCatalogFromBusinessId: copyCatalog ? copyFromShopId : null,
      })
      api.setToken(res.token)
      setNewShopName('')
      setCopyCatalog(false)
      setCopyFromShopId('')
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
            src="/brand/jora-reservly-mark.png"
            alt=""
            className="h-8 w-auto max-w-[32px] object-contain object-left shrink-0"
          />
          <div className="min-w-0 leading-tight">
            <p className="font-bold text-[15px] truncate text-primary">Reservly</p>
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
              <div className="space-y-1.5">
                <div className="flex gap-1">
                  <input
                    className="flex-1 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1"
                    placeholder="New shop name"
                    value={newShopName}
                    onChange={(e) => setNewShopName(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={addingShop || newShopName.trim().length < 2 || (copyCatalog && !copyFromShopId)}
                    onClick={handleAddShop}
                    className="text-xs px-2 py-1 rounded-md bg-primary text-white disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
                {shops.length > 0 && (
                  <label className="flex items-start gap-1.5 px-1 text-[11px] text-gray-500 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5 rounded border-gray-300"
                      checked={copyCatalog}
                      onChange={(e) => {
                        setCopyCatalog(e.target.checked)
                        if (e.target.checked && !copyFromShopId && config?.id) {
                          setCopyFromShopId(config.id)
                        }
                      }}
                    />
                    <span>Prefill items from an existing shop</span>
                  </label>
                )}
                {copyCatalog && (
                  <select
                    className="w-full text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1"
                    value={copyFromShopId}
                    onChange={(e) => setCopyFromShopId(e.target.value)}
                  >
                    <option value="">Select shop…</option>
                    {shops.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
                <p className="text-[10px] text-gray-400 px-1 leading-snug">
                  {copyCatalog
                    ? 'Categories, services, products, and images are copied into the new shop.'
                    : 'Leave unchecked to start this shop from scratch.'}
                </p>
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
            {!config && loadingSession ? (
              <div className="space-y-3 max-w-md">
                <div className="skeleton h-8 w-48" />
                <div className="skeleton h-24 w-full" />
                <p className="text-sm text-gray-500">Loading your shop…</p>
              </div>
            ) : !config && sessionError ? (
              <div className="max-w-md space-y-3 bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-800 rounded-xl p-5">
                <h2 className="font-semibold text-lg">Couldn’t reach the server</h2>
                <p className="text-sm text-gray-500">
                  You’re still signed in. This is usually a temporary network or server delay — try again in a moment.
                </p>
                <p className="text-xs text-gray-400 break-words">{sessionError}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void loadSession()}
                    className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium"
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm"
                  >
                    Sign out
                  </button>
                </div>
              </div>
            ) : (
              <Outlet />
            )}
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
