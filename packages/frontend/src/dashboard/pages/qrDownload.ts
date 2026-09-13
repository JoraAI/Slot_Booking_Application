/**
 * Platform helpers for QR PNG save — kept free of React for unit tests.
 */

import { Capacitor } from '@capacitor/core'

/** Keep in sync with the Capacitor branch in QRCodePage.download(). */
export const CAPACITOR_NATIVE_STRATEGY = 'capacitor-native' as const

export function isIosDevice(
  nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> =
    typeof navigator !== 'undefined'
      ? navigator
      : { userAgent: '', platform: '', maxTouchPoints: 0 }
): boolean {
  return (
    /iPad|iPhone|iPod/.test(nav.userAgent) ||
    (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
  )
}

export type QrDownloadStrategy =
  | typeof CAPACITOR_NATIVE_STRATEGY
  | 'ios-share-or-overlay'
  | 'blob-anchor-download'

/**
 * Capacitor native app (Android / iOS):
 *   Save PNG into the device photo library / gallery (direct image save).
 *
 * iOS browser:
 *   Use Web Share API / long-press overlay.
 *
 * Normal browser:
 *   Use blob + <a download> (true PNG file download).
 */
export function qrDownloadStrategy(
  nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> =
    typeof navigator !== 'undefined'
      ? navigator
      : { userAgent: '', platform: '', maxTouchPoints: 0 }
): QrDownloadStrategy {
  if (Capacitor.isNativePlatform()) {
    return CAPACITOR_NATIVE_STRATEGY
  }

  if (isIosDevice(nav)) {
    return 'ios-share-or-overlay'
  }

  return 'blob-anchor-download'
}

export function sanitizeQrFileName(businessName: string): string {
  return `${(businessName || 'business').replace(/[^\w-]+/g, '_')}-booking-qr.png`
}

/** Album used when saving QR images into the device gallery (native apps). */
export const QR_GALLERY_ALBUM = 'Jora Reservly'
