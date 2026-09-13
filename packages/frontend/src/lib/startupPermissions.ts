import { Capacitor } from '@capacitor/core'

const PROMPTED_KEY = 'jora.startupPermissions.v1'

/**
 * Ask for runtime permissions once on first native launch (not mid-flow on Save PNG).
 * Location is used when pinning the business on the map in Settings.
 * QR PNG save on Android does not need Photos/media permission (app-album MediaStore path).
 *
 * Note: Capacitor Geolocation refuses to show the dialog when system Location is off.
 * In that case we do not mark as prompted, so the next cold start can try again.
 */
export async function requestStartupPermissions(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return

  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(PROMPTED_KEY) === '1') {
      return
    }

    const { Geolocation } = await import('@capacitor/geolocation')
    await Geolocation.requestPermissions()

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PROMPTED_KEY, '1')
    }
  } catch (err) {
    console.warn('Startup permission prompt skipped:', err)
  }
}
