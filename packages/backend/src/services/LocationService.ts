/**
 * Batch 4 — salon location helpers.
 *
 * Google Maps directions links are generated server-side using the free
 * `https://www.google.com/maps/dir/?api=1&destination=...` endpoint — no Maps
 * API key, no Places, no geocoding. Coordinates are preferred when both are
 * present; otherwise the (URI-encoded) address is used. A client-supplied maps
 * URL is never stored as authoritative.
 */

export interface LocationInfo {
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  directionsUrl: string | null;
}

/** Build a Google Maps directions URL, or null when no usable location exists. */
export function directionsUrl(
  address?: string | null,
  latitude?: number | null,
  longitude?: number | null
): string | null {
  if (latitude != null && longitude != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  }
  const trimmed = typeof address === 'string' ? address.trim() : '';
  if (trimmed) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(trimmed)}`;
  }
  return null;
}

/** Safe, location-only projection of a business (never owner secrets). */
export function locationInfo(business: {
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): LocationInfo {
  const address = typeof business.address === 'string' && business.address.trim() ? business.address.trim() : null;
  const latitude = typeof business.latitude === 'number' ? business.latitude : null;
  const longitude = typeof business.longitude === 'number' ? business.longitude : null;
  return {
    address,
    latitude,
    longitude,
    directionsUrl: directionsUrl(address, latitude, longitude),
  };
}

/** Validate a location payload; returns an error string or null when valid. */
export function validateLocation(data: {
  address?: unknown;
  latitude?: unknown;
  longitude?: unknown;
}): string | null {
  if (data.address !== undefined && data.address !== null) {
    const address = String(data.address).trim();
    if (address.length > 500) return 'Address must be 500 characters or fewer';
  }
  const hasLat = data.latitude !== undefined && data.latitude !== null;
  const hasLng = data.longitude !== undefined && data.longitude !== null;
  if (hasLat !== hasLng) return 'Latitude and longitude must be set together';
  if (hasLat) {
    const lat = Number(data.latitude);
    const lng = Number(data.longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return 'Latitude must be between -90 and 90';
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return 'Longitude must be between -180 and 180';
  }
  return null;
}
