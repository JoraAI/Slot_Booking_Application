/**
 * Platform helpers — safe on web and Capacitor (Android/iOS).
 * Never import Capacitor plugins at top-level in a way that breaks Vite SSR/web;
 * dynamic import when native.
 */
import { Capacitor } from '@capacitor/core'

export function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

export function nativePlatform(): string {
  try {
    return Capacitor.getPlatform()
  } catch {
    return 'web'
  }
}

/** Open an https URL in system browser / Custom Tabs (native) or new tab (web). */
export async function openExternalUrl(url: string): Promise<void> {
  if (!url) return
  if (isNativePlatform()) {
    const { Browser } = await import('@capacitor/browser')
    await Browser.open({ url })
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * Show HTML (invoices) without relying on blob: + window.open (broken in many WebViews).
 * Dispatches a global event consumed by HtmlDocumentOverlay.
 */
export function openHtmlDocument(html: string, title = 'Document'): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('reservly:open-html', { detail: { html, title } }))
}

/** Current position — Capacitor Geolocation on native, browser API on web. */
export async function getCurrentPositionCoords(): Promise<{ latitude: number; longitude: number }> {
  if (isNativePlatform()) {
    const { Geolocation } = await import('@capacitor/geolocation')
    const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 })
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude }
  }
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(Object.assign(new Error('unsupported'), { code: 0 }))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60_000 },
    )
  })
}
