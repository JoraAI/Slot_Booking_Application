/**
 * Owner token storage:
 * - Native (Android/iOS): Capacitor Preferences — survives app close / next-day reopen
 *   until JWT expiry (~7d) or explicit Logout.
 * - Web: sessionStorage only — closing the browser/tab ends the session.
 */
import { Preferences } from '@capacitor/preferences'
import { isNativePlatform } from './native'

const KEY = 'owner_token'
const memory = { token: null as string | null }

function clearLegacyWebLocalStorage() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}

export async function hydrateOwnerToken(): Promise<string | null> {
  if (isNativePlatform()) {
    const { value } = await Preferences.get({ key: KEY })
    if (value) {
      memory.token = value
      try {
        localStorage.setItem(KEY, value)
      } catch {
        // WebView localStorage mirror is best-effort.
      }
      return value
    }
    // Prefer Preferences, but do not wipe a still-valid WebView session if
    // Preferences was empty (e.g. prior write raced / failed).
    let legacy: string | null = null
    try {
      legacy = localStorage.getItem(KEY)
    } catch {
      legacy = null
    }
    if (legacy) {
      memory.token = legacy
      try {
        await Preferences.set({ key: KEY, value: legacy })
      } catch {
        // Keep memory + localStorage even if Preferences write fails.
      }
      return legacy
    }
    memory.token = null
    return null
  }

  // Web: session-only. Drop any multi-day localStorage token from older builds.
  clearLegacyWebLocalStorage()
  try {
    memory.token = sessionStorage.getItem(KEY)
  } catch {
    memory.token = null
  }
  return memory.token
}

export function getOwnerTokenSync(): string | null {
  if (memory.token != null) return memory.token
  if (isNativePlatform()) {
    try {
      return localStorage.getItem(KEY)
    } catch {
      return null
    }
  }
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

export async function setOwnerToken(token: string | null): Promise<void> {
  memory.token = token

  if (isNativePlatform()) {
    try {
      if (token) localStorage.setItem(KEY, token)
      else localStorage.removeItem(KEY)
    } catch {
      // ignore
    }
    try {
      if (token) await Preferences.set({ key: KEY, value: token })
      else await Preferences.remove({ key: KEY })
    } catch (err) {
      console.warn('[Reservly] Failed to persist owner token to Preferences', err)
    }
    return
  }

  // Web: do not use localStorage — session ends when the browser tab/session closes.
  clearLegacyWebLocalStorage()
  try {
    if (token) sessionStorage.setItem(KEY, token)
    else sessionStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
