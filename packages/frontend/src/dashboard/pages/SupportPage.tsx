import React, { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import { useStore } from '../../store'

const CATEGORIES = [
  { value: 'bug', label: 'Bug' },
  { value: 'enhancement', label: 'Enhancement / feature request' },
  { value: 'billing', label: 'Billing / subscription' },
  { value: 'account', label: 'Account / access' },
  { value: 'other', label: 'Other' },
] as const

type Category = (typeof CATEGORIES)[number]['value']

const MAX_VOICE_SECONDS = 90
const MAX_VOICE_BYTES = 2 * 1024 * 1024

const inputClass =
  'w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-primary/30'

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(new Error('Could not read the voice recording'))
    reader.readAsDataURL(blob)
  })
}

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ]
  return candidates.find((t) => MediaRecorder.isTypeSupported(t))
}

function formatSeconds(total: number) {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export const SupportPage: React.FC = () => {
  const { config } = useStore()
  const [category, setCategory] = useState<Category>('bug')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  const [recording, setRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [voicePreviewUrl, setVoicePreviewUrl] = useState<string | null>(null)
  const [hasVoice, setHasVoice] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const autoStopTimeoutRef = useRef<number | null>(null)
  const voicePreviewRef = useRef<string | null>(null)
  const voiceBlobRef = useRef<Blob | null>(null)
  const voiceMimeRef = useRef<string>('audio/webm')
  const cancelledRef = useRef(false)
  const mountedRef = useRef(true)

  const clearVoiceLocal = () => {
    voiceBlobRef.current = null
    voiceMimeRef.current = 'audio/webm'
    if (voicePreviewRef.current) {
      URL.revokeObjectURL(voicePreviewRef.current)
      voicePreviewRef.current = null
    }
    setVoicePreviewUrl(null)
    setHasVoice(false)
    setRecordSeconds(0)
  }

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  const stopTimer = () => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (autoStopTimeoutRef.current != null) {
      window.clearTimeout(autoStopTimeoutRef.current)
      autoStopTimeoutRef.current = null
    }
  }

  useEffect(() => {
    mountedRef.current = true
    cancelledRef.current = false
    return () => {
      mountedRef.current = false
      cancelledRef.current = true
      stopTimer()
      stopStream()
      const recorder = mediaRecorderRef.current
      if (recorder) {
        recorder.ondataavailable = null
        recorder.onstop = null
        if (recorder.state !== 'inactive') {
          try {
            recorder.stop()
          } catch {
            // ignore
          }
        }
      }
      if (voicePreviewRef.current) URL.revokeObjectURL(voicePreviewRef.current)
    }
  }, [])

  const finishRecording = (blob: Blob, mimeType: string) => {
    if (cancelledRef.current || !mountedRef.current) return
    if (!blob.size) {
      toast.error('Recording was empty — try again')
      return
    }
    if (blob.size > MAX_VOICE_BYTES) {
      toast.error('Voice note is too large (max 2MB). Keep it under about 90 seconds.')
      return
    }

    const localUrl = URL.createObjectURL(blob)
    if (voicePreviewRef.current) URL.revokeObjectURL(voicePreviewRef.current)
    voicePreviewRef.current = localUrl
    voiceBlobRef.current = blob
    voiceMimeRef.current = mimeType.split(';')[0] || 'audio/webm'
    setVoicePreviewUrl(localUrl)
    setHasVoice(true)
    toast.success('Voice note ready to send')
  }

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') {
      setRecording(false)
      stopTimer()
      stopStream()
      return
    }
    try {
      recorder.stop()
    } catch {
      setRecording(false)
      stopTimer()
      stopStream()
    }
  }

  const startRecording = async () => {
    if (recording || sending) return
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      toast.error('Voice recording is not supported on this device')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (cancelledRef.current || !mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream
      const mimeType = pickRecorderMime()
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
      mediaRecorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data)
      }
      recorder.onstop = () => {
        stopTimer()
        stopStream()
        if (mountedRef.current) setRecording(false)
        if (cancelledRef.current || !mountedRef.current) {
          chunksRef.current = []
          return
        }
        const type = recorder.mimeType || mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type })
        chunksRef.current = []
        finishRecording(blob, type)
      }
      recorder.start(250)
      setRecording(true)
      setRecordSeconds(0)
      timerRef.current = window.setInterval(() => {
        setRecordSeconds((prev) => prev + 1)
      }, 1000)
      autoStopTimeoutRef.current = window.setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          stopRecording()
        }
      }, MAX_VOICE_SECONDS * 1000)
    } catch {
      stopStream()
      toast.error('Microphone permission is required to record a voice note')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const sub = subject.trim()
    const msg = message.trim()
    const voiceBlob = voiceBlobRef.current

    if (recording) {
      toast.error('Stop the voice recording before submitting')
      return
    }

    if (!voiceBlob) {
      if (sub.length < 3) {
        toast.error('Subject must be at least 3 characters')
        return
      }
      if (msg.length < 10) {
        toast.error('Please describe the issue in at least 10 characters')
        return
      }
    } else {
      if (sub && sub.length < 3) {
        toast.error('Subject must be at least 3 characters when provided')
        return
      }
      if (msg && msg.length < 10) {
        toast.error('Details must be at least 10 characters when provided')
        return
      }
    }

    setSending(true)
    try {
      let voiceNoteBase64: string | null = null
      let voiceNoteMimeType: string | null = null
      if (voiceBlob) {
        voiceNoteBase64 = await blobToBase64(voiceBlob)
        voiceNoteMimeType = voiceMimeRef.current
      }
      await api.submitSupportTicket({
        category,
        subject: sub,
        message: msg,
        voiceNoteBase64,
        voiceNoteMimeType,
      })
      setSent(true)
      setSubject('')
      setMessage('')
      setCategory('bug')
      clearVoiceLocal()
      toast.success('Ticket sent - we will reply by email')
    } catch (err: any) {
      toast.error(err?.message || 'Could not send ticket')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4 sm:space-y-6 px-0 sm:px-0">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">Support</h1>
        <p className="text-sm text-gray-500 mt-1">
          Raise a ticket for bugs, enhancements, or account help. Messages go to{' '}
          <a className="text-primary underline break-all" href="mailto:admin@staffingpros.tech">
            admin@staffingpros.tech
          </a>
          .
        </p>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 sm:p-6 space-y-4">
        {config && (
          <div className="text-xs sm:text-sm text-gray-500 bg-gray-50 dark:bg-gray-800/60 rounded-lg px-3 py-2 space-y-0.5">
            <p>
              Shop: <span className="text-gray-800 dark:text-gray-200 font-medium">{config.name}</span>
            </p>
            <p className="break-all">
              Reply will go to your login email. We include shop details automatically.
            </p>
          </div>
        )}

        {sent && (
          <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-800 px-3 py-2 text-sm text-green-800 dark:text-green-300">
            Ticket submitted. Check your inbox for our reply (we use your account email as Reply-To).
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="support-category">
              Category
            </label>
            <select
              id="support-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              className={inputClass}
              disabled={sending}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="support-subject">
              Subject{hasVoice ? ' (optional with voice note)' : ''}
            </label>
            <input
              id="support-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={120}
              placeholder={hasVoice ? 'Optional short summary' : 'Short summary'}
              className={inputClass}
              disabled={sending}
              autoComplete="off"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="support-message">
              Details{hasVoice ? ' (optional with voice note)' : ''}
            </label>
            <textarea
              id="support-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={4000}
              rows={8}
              placeholder={
                hasVoice
                  ? 'Optional written details — your voice note will be emailed as an attachment…'
                  : 'What happened? Steps to reproduce, device/browser, or what you’d like improved…'
              }
              className={`${inputClass} min-h-[160px] resize-y`}
              disabled={sending}
            />
            <p className="text-xs text-gray-400 mt-1 text-right">{message.trim().length}/4000</p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium">Voice note (optional)</label>
            <p className="text-xs text-gray-500">
              Record up to {MAX_VOICE_SECONDS} seconds. The clip is emailed as an attachment (not stored on the server).
              With a voice note, subject and details are optional.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {!recording ? (
                <button
                  type="button"
                  onClick={() => void startRecording()}
                  disabled={sending}
                  className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                >
                  {hasVoice ? 'Re-record' : 'Record voice note'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopRecording}
                  className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium"
                >
                  Stop · {formatSeconds(recordSeconds)}
                </button>
              )}
              {hasVoice && !recording && (
                <button
                  type="button"
                  onClick={clearVoiceLocal}
                  disabled={sending}
                  className="px-3 py-2 text-sm text-gray-500 hover:text-red-600 disabled:opacity-50"
                >
                  Remove
                </button>
              )}
              {hasVoice && !recording && (
                <span className="text-xs text-green-600">Ready to attach</span>
              )}
            </div>
            {voicePreviewUrl && (
              <audio controls src={voicePreviewUrl} className="w-full mt-1" preload="metadata" />
            )}
          </div>

          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:items-center sm:justify-between pt-1">
            <a
              href="mailto:admin@staffingpros.tech"
              className="text-sm text-gray-500 hover:text-primary text-center sm:text-left underline-offset-2 hover:underline"
            >
              Or email us directly
            </a>
            <button
              type="submit"
              disabled={sending || recording}
              className="w-full sm:w-auto px-5 py-2.5 bg-primary hover:bg-primary-dark text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Submit ticket'}
            </button>
          </div>
        </form>
      </div>

      <p className="text-xs text-gray-400 leading-relaxed">
        Tip: send a voice note alone, or add written details. Limit: a few tickets per hour per shop.
      </p>
    </div>
  )
}
