import React, { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { api } from '../../lib/api'
import toast from 'react-hot-toast'
import { qrDownloadStrategy, sanitizeQrFileName } from './qrDownload'

export const QRCodePage: React.FC = () => {
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [iosSaveUrl, setIosSaveUrl] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const iosSaveUrlRef = useRef<string | null>(null)

  useEffect(() => {
    api.getQrInfo()
      .then((info) => {
        setUrl(info.url)
        setName(info.businessName)
      })
      .catch(() => toast.error('Failed to load QR code'))
      .finally(() => setLoading(false))
  }, [])

  // The canvas only exists once loading finishes, so draw after it mounts.
  useEffect(() => {
    if (loading || !url || !canvasRef.current) return
    QRCode.toCanvas(canvasRef.current, url, {
      width: 256,
      margin: 2,
      color: { dark: '#111827', light: '#ffffff' },
    }).catch(() => toast.error('Failed to render QR code'))
  }, [loading, url])

  useEffect(() => {
    return () => {
      if (iosSaveUrlRef.current) URL.revokeObjectURL(iosSaveUrlRef.current)
    }
  }, [])

  const closeIosSave = () => {
    if (iosSaveUrlRef.current) {
      URL.revokeObjectURL(iosSaveUrlRef.current)
      iosSaveUrlRef.current = null
    }
    setIosSaveUrl(null)
  }

  const showIosSaveSheet = (blob: Blob) => {
    if (iosSaveUrlRef.current) URL.revokeObjectURL(iosSaveUrlRef.current)
    const objectUrl = URL.createObjectURL(blob)
    iosSaveUrlRef.current = objectUrl
    setIosSaveUrl(objectUrl)
    toast.success('Long-press the image → Add to Photos')
  }

  const download = async () => {
    const canvas = canvasRef.current
    if (!canvas) return

    const fileName = sanitizeQrFileName(name)

    const blob: Blob | null = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/png')
    })
    if (!blob) {
      toast.error('Could not create QR image')
      return
    }

    // iOS: <a download> is ignored — use Share → Save Image, then long-press overlay.
    // Android Chrome / Capacitor WebView + Mac desktop: blob + download attribute.
    if (qrDownloadStrategy() === 'ios-share-or-overlay') {
      try {
        const file = new File([blob], fileName, { type: 'image/png' })
        const payload = { files: [file], title: fileName }
        if (typeof navigator.canShare === 'function' && navigator.canShare(payload)) {
          await navigator.share(payload)
          toast.success('Use Save Image / Save to Files in the share sheet')
          return
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return
      }
      showIosSaveSheet(blob)
      return
    }

    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = fileName
    a.rel = 'noopener'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2_000)
    toast.success('QR downloaded')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">QR Code</h1>
        <p className="text-sm text-gray-500 mt-1">Display this QR at your business so customers can book instantly.</p>
      </div>

      <div className="max-w-sm bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 space-y-4">
        {loading ? (
          <div className="skeleton h-64 w-64 mx-auto" />
        ) : (
          <>
            <div className="flex justify-center bg-white rounded-xl p-4">
              <canvas ref={canvasRef} className="w-64 h-64" />
            </div>
            <div>
              <p className="font-medium text-center">{name}</p>
              <p className="text-xs text-gray-400 text-center mt-1 break-all">{url}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { navigator.clipboard.writeText(url); toast.success('Link copied!') }}
                className="flex-1 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Copy Link
              </button>
              <button
                onClick={() => void download()}
                className="flex-1 py-2.5 bg-primary hover:bg-primary-dark text-white rounded-lg text-sm font-medium"
              >
                Download PNG
              </button>
            </div>
          </>
        )}
      </div>

      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 text-sm">
        <p className="font-medium text-amber-700 dark:text-amber-400 mb-1">💡 Tips</p>
        <ul className="text-amber-600 dark:text-amber-500 space-y-1 list-disc list-inside">
          <li>Place it at the reception or on mirrors/desks.</li>
          <li>The link uses a secure, opaque code that resolves to exactly your business.</li>
          <li>Bookings made from this QR are tracked as <strong>QR</strong> source in analytics.</li>
          <li>On iPhone: Download opens Share → choose <strong>Save Image</strong>, or long-press the preview.</li>
        </ul>
      </div>

      {iosSaveUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={closeIosSave}
          role="dialog"
          aria-modal="true"
          aria-label="Save QR code"
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl p-6 max-w-sm w-full space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-medium text-center">Long-press the QR → Add to Photos</p>
            <img
              src={iosSaveUrl}
              alt="Booking QR code"
              className="w-64 h-64 mx-auto bg-white rounded-lg"
            />
            <button
              type="button"
              onClick={closeIosSave}
              className="w-full py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
