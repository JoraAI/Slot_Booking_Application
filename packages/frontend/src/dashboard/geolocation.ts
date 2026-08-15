/**
 * Browser geolocation helpers for the owner Settings Location card (Batch 4).
 * Pure and injectable so error handling can be unit-tested without a browser.
 */

export type GeoFailureKind = 'unsupported' | 'insecure' | 'denied' | 'timeout' | 'unavailable'

export function geolocationAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator
}

export function secureContextAvailable(): boolean {
  // In an insecure or non-browser environment we cannot rely on geolocation.
  return typeof window === 'undefined' || window.isSecureContext !== false
}

export function geoFailureMessage(kind: GeoFailureKind): string {
  switch (kind) {
    case 'unsupported':
      return 'Geolocation is not supported by this browser.'
    case 'insecure':
      return 'Geolocation requires a secure context (HTTPS) or localhost.'
    case 'denied':
      return 'Location permission was denied. Allow location access in your browser.'
    case 'timeout':
      return 'Location request timed out. Try again.'
    case 'unavailable':
      return 'Unable to get your location. Check browser settings and try again.'
  }
}

/** Map a GeolocationPositionError.code (1 = denied, 3 = timeout) to a failure kind. */
export function mapPositionError(code: number): GeoFailureKind {
  if (code === 1) return 'denied'
  if (code === 3) return 'timeout'
  return 'unavailable'
}
