import React, { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { api } from '../../lib/api'
import toast from 'react-hot-toast'

export const QRCodePage: React.FC = () => {
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    api.getQrInfo()
      .then((info) => {
        setUrl(info.url)
        setName(info.businessName)
        if (canvasRef.current) {
          QRCode.toCanvas(canvasRef.current, info.url, {
            width: 256,
            margin: 2,
            color: { dark: '#111827', light: '#ffffff' },
          })
        }
      })
      .catch(() => toast.error('Failed to load QR code'))
      .finally(() => setLoading(false))
  }, [])

  const download = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = `${name || 'business'}-booking-qr.png`
    a.click()
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
                onClick={download}
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
        </ul>
      </div>
    </div>
  )
}
