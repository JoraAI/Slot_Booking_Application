/**
 * Batch 4 - salon location helpers.
 *
 * Google Maps directions links are generated server-side using the free
 * `https://www.google.com/maps/dir/?api=1&destination=...` endpoint - no Maps
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

const GOOGLE_REVIEW_HOSTS = new Set([
  'google.com',
  'www.google.com',
  'maps.google.com',
  'maps.app.goo.gl',
  'goo.gl',
  'g.page',
  'www.g.page',
]);

/**
 * Normalize / validate an owner-supplied Google review link.
 * Empty → null (clear). Otherwise must be https with an allowlisted Google host.
 */
export function normalizeGoogleReviewUrl(
  raw: unknown
): { ok: true; url: string | null } | { ok: false; error: string } {
  if (raw === null || raw === '') {
    return { ok: true, url: null };
  }
  const trimmed = String(raw).trim();
  if (!trimmed) return { ok: true, url: null };
  if (trimmed.length > 2000) {
    return { ok: false, error: 'Google review link must be 2000 characters or fewer' };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Enter a valid Google review link (https://…)' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'Google review link must start with https://' };
  }
  const host = parsed.hostname.toLowerCase();
  const allowed =
    GOOGLE_REVIEW_HOSTS.has(host) ||
    host.endsWith('.google.com') ||
    host.endsWith('.g.page');
  if (!allowed) {
    return {
      ok: false,
      error: 'Use a Google Maps / Business review link (google.com, g.page, or maps.app.goo.gl)',
    };
  }
  return { ok: true, url: parsed.toString() };
}
