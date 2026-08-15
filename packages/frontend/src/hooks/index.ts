import { useStore } from '../store'
import { api } from '../lib/api'
import type { PublicConfig, BusinessConfig, AvailabilityResult } from '../types'
import { useEffect, useState, useCallback } from 'react'

export function useBusinessConfig(slug: string | undefined) {
  const { config, setConfig } = useStore()
  const [loading, setLoading] = useState(!config)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    api.getOwnerMe()
      .then(setConfig)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [slug, setConfig])

  return { config: config as BusinessConfig | null, loading, error }
}

export function usePublicConfig(identifier: string | undefined) {
  const { publicConfig, setPublicConfig } = useStore()
  const [loading, setLoading] = useState(!publicConfig)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!identifier) return
    setLoading(true)
    api.getConfig(identifier)
      .then(setPublicConfig)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [identifier, setPublicConfig])

  return { config: publicConfig as PublicConfig | null, loading, error }
}

export function useAvailability(identifier: string | undefined, date: string | null, serviceId: string | null, staffId?: string | null) {
  const [availability, setAvailability] = useState<AvailabilityResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!identifier || !date || !serviceId) return
    setLoading(true)
    api.getAvailability(identifier, date, serviceId, staffId || undefined)
      .then(setAvailability)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [identifier, date, serviceId, staffId])

  return { availability, slots: availability?.slots || [], loading, error }
}

export function useEmbedMode() {
  const { isEmbedded, setIsEmbedded } = useStore()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const embed = params.get('embed')
    if (embed === 'true' || embed === '1' || window.parent !== window) {
      setIsEmbedded(true)
    }

    // Inject theme from URL params
    const primary = params.get('primary')
    const radius = params.get('radius')
    if (primary) document.documentElement.style.setProperty('--color-primary', primary)
    if (radius) document.documentElement.style.setProperty('--radius-md', radius + 'px')
  }, [setIsEmbedded])

  return isEmbedded
}

export function usePostMessage() {
  // Never let embed messaging break the flow that triggered it: a booking can
  // already be committed server-side by the time this runs.
  const send = useCallback((type: string, data: Record<string, unknown>) => {
    try {
      if (window.parent !== window) {
        window.parent.postMessage({ type, ...data }, '*')
      }
    } catch {
      /* embed host unreachable */
    }
  }, [])
  return send
}

export function useCountUp(target: number, duration = 1000) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let start = 0
    const startTime = performance.now()
    const step = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      start = Math.floor(progress * target)
      setCount(start)
      if (progress < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [target, duration])
  return count
}