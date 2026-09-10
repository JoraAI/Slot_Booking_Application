/** Platform helpers for QR PNG save — kept free of React for unit tests. */

export function isIosDevice(
  nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> = typeof navigator !== 'undefined'
    ? navigator
    : { userAgent: '', platform: '', maxTouchPoints: 0 }
): boolean {
  return /iPad|iPhone|iPod/.test(nav.userAgent) ||
    (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
}

export type QrDownloadStrategy = 'ios-share-or-overlay' | 'blob-anchor-download'

/**
 * Android + Mac/desktop: real file download via blob + <a download>.
 * iOS (incl. iPadOS desktop UA): share sheet / long-press overlay — download attr is ignored.
 */
export function qrDownloadStrategy(
  nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> = typeof navigator !== 'undefined'
    ? navigator
    : { userAgent: '', platform: '', maxTouchPoints: 0 }
): QrDownloadStrategy {
  return isIosDevice(nav) ? 'ios-share-or-overlay' : 'blob-anchor-download'
}

export function sanitizeQrFileName(businessName: string): string {
  return `${(businessName || 'business').replace(/[^\w\-]+/g, '_')}-booking-qr.png`
}
