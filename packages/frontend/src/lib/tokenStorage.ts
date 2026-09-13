/**
 * Token persistence - Preferences on native (survives WebView storage quirks),
 * localStorage on web. Sync API kept for existing call sites; hydrate on boot.
 */
import { Preferences } from '@capacitor/preferences'
import { isNativePlatform } from './native'

const KEY = 'owner_token'
const memory = { token: null as string | null }

export async function hydrateOwnerToken(): Promise<string | null> {
  if (isNativePlatform()) {
    const { value } = await Preferences.get({ key: KEY })
    if (value) {
      memory.token = value
      localStorage.setItem(KEY, value)
      return value
    }
    // Prefer Preferences, but do not wipe a still-valid WebView session if
    // Preferences was empty (e.g. prior write raced / failed).
    const legacy = localStorage.getItem(KEY)
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
  memory.token = localStorage.getItem(KEY)
  return memory.token
}

export function getOwnerTokenSync(): string | null {
  if (memory.token != null) return memory.token
  return localStorage.getItem(KEY)
}

export async function setOwnerToken(token: string | null): Promise<void> {
  memory.token = token
  if (token) localStorage.setItem(KEY, token)
  else localStorage.removeItem(KEY)
  if (isNativePlatform()) {
    try {
      if (token) await Preferences.set({ key: KEY, value: token })
      else await Preferences.remove({ key: KEY })
    } catch (err) {
      console.warn('[Reservly] Failed to persist owner token to Preferences', err)
    }
  }
}
