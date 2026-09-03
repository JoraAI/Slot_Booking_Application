/**
 * Token persistence — Preferences on native (survives WebView storage quirks),
 * localStorage on web. Sync API kept for existing call sites; hydrate on boot.
 */
import { Preferences } from '@capacitor/preferences'
import { isNativePlatform } from './native'

const KEY = 'owner_token'
const memory = { token: null as string | null }

export async function hydrateOwnerToken(): Promise<string | null> {
  if (isNativePlatform()) {
    const { value } = await Preferences.get({ key: KEY })
    memory.token = value
    if (value) localStorage.setItem(KEY, value)
    else localStorage.removeItem(KEY)
    return value
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
    if (token) await Preferences.set({ key: KEY, value: token })
    else await Preferences.remove({ key: KEY })
  }
}
