import { useStore } from '../store'
import { api } from '../lib/api'
import type { BusinessConfig, TimeSlot } from '../types'
import { useEffect, useState, useCallback } from 'react'

export function useBusinessConfig(slug: string | undefined) {
  const { config, setConfig } = useStore()
  const [loading, setLoading] = useState(!config)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    api.getConfig(slug)
      .then(setConfig)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [slug, setConfig])

  return { config, loading, error }
}

export function useAvailability(slug: string | undefined, date: string | null, staffId?: string | null) {
  const [slots, setSlots] = useState<TimeSlot[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug || !date) return
    setLoading(true)
    api.getAvailability(slug, date, staffId || undefined)
      .then(setSlots)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [slug, date, staffId])

  return { slots, loading, error }
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
  const send = useCallback((type: string, data: Record<string, unknown>) => {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, '*')
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