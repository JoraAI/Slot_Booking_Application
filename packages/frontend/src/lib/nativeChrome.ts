import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'

/**
 * Keep the WebView below the camera / status bar on Android + iOS
 * (fixes punch-hole devices like Oppo A79 overlapping the top chrome).
 */
export async function configureNativeChrome(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return

  try {
    await StatusBar.setOverlaysWebView({ overlay: false })
    await StatusBar.setStyle({ style: Style.Light })
    await StatusBar.setBackgroundColor({ color: '#ffffff' })
  } catch (err) {
    console.warn('StatusBar setup skipped:', err)
  }
}
