import React, { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { isNativePlatform } from '../lib/native'

/**
 * Android/iOS hardware back → React Router history.
 * Exits only when already at the owner root (/login or /dashboard).
 */
export function useNativeBackButton() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (!isNativePlatform()) return
    let handle: { remove: () => Promise<void> } | undefined

    void (async () => {
      const { App } = await import('@capacitor/app')
      handle = await App.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack || window.history.length > 1) {
          navigate(-1)
          return
        }
        const path = location.pathname
        if (path.startsWith('/dashboard') && path !== '/dashboard') {
          navigate('/dashboard')
          return
        }
        if (path !== '/login') {
          navigate('/login')
          return
        }
        void App.exitApp()
      })
    })()

    return () => {
      void handle?.remove()
    }
  }, [navigate, location.pathname])
}

export const NativeBackHandler: React.FC = () => {
  useNativeBackButton()
  return null
}
