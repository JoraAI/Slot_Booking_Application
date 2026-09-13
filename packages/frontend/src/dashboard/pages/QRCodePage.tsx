import React, { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { Media } from '@capacitor-community/media'
import { api } from '../../lib/api'
import toast from 'react-hot-toast'
import {
  CAPACITOR_NATIVE_STRATEGY,
  QR_GALLERY_ALBUM,
  qrDownloadStrategy,
  sanitizeQrFileName,
} from './qrDownload'

/**
 * Convert a Blob into a base64 string without the data URL prefix.
 */
async function blobToBase64(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onloadend = () => {
      const result = reader.result

      if (typeof result !== 'string') {
        reject(new Error('Failed to convert image to base64'))
        return
      }

      const commaIndex = result.indexOf(',')

      if (commaIndex === -1) {
        reject(new Error('Invalid data URL'))
        return
      }

      resolve(result.slice(commaIndex + 1))
    }

    reader.onerror = () => {
      reject(reader.error ?? new Error('Failed to read image'))
    }

    reader.readAsDataURL(blob)
  })
}

/** Resolve or create the Reservly album (Android MediaStore needs an album id). */
async function resolveQrAlbumId(): Promise<string | undefined> {
  const { albums } = await Media.getAlbums()
  const existing = albums.find((a) => a.name === QR_GALLERY_ALBUM)
  if (existing?.identifier) return existing.identifier

  await Media.createAlbum({ name: QR_GALLERY_ALBUM })
  const refreshed = await Media.getAlbums()
  return refreshed.albums.find((a) => a.name === QR_GALLERY_ALBUM)?.identifier
}

/**
 * Native Android/iOS: save a real PNG into Photos/Gallery.
 * No storage permission at app launch — iOS may prompt once to allow adding photos.
 * Share sheet is only a fallback (avoid Print → PDF).
 */
async function savePngOnNativeApp(blob: Blob, fileName: string): Promise<'gallery' | 'share'> {
  const base64 = await blobToBase64(blob)
  const dataUrl = `data:image/png;base64,${base64}`
  const stem = fileName.replace(/\.png$/i, '')

  try {
    const albumIdentifier = await resolveQrAlbumId()
    await Media.savePhoto({
      path: dataUrl,
      fileName: stem,
      ...(albumIdentifier ? { albumIdentifier } : {}),
    })
    return 'gallery'
  } catch (galleryErr) {
    console.warn('Gallery PNG save failed; falling back to share sheet', galleryErr)

    await Filesystem.writeFile({
      path: fileName,
      data: base64,
      directory: Directory.Cache,
    })
    const file = await Filesystem.getUri({
      path: fileName,
      directory: Directory.Cache,
    })
    await Share.share({
      title: fileName,
      files: [file.uri],
      dialogTitle: 'Save QR as PNG',
    })
    return 'share'
  }
}

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
      .catch(() => {
        toast.error('Failed to load QR code')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (loading || !url || !canvasRef.current) return

    QRCode.toCanvas(
      canvasRef.current,
      url,
      {
        width: 256,
        margin: 2,
        color: {
          dark: '#111827',
          light: '#ffffff',
        },
      },
    ).catch(() => {
      toast.error('Failed to render QR code')
    })
  }, [loading, url])

  useEffect(() => {
    return () => {
      if (iosSaveUrlRef.current) {
        URL.revokeObjectURL(iosSaveUrlRef.current)
      }
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
    if (iosSaveUrlRef.current) {
      URL.revokeObjectURL(iosSaveUrlRef.current)
    }

    const objectUrl = URL.createObjectURL(blob)

    iosSaveUrlRef.current = objectUrl
    setIosSaveUrl(objectUrl)

    toast.success('Long-press the image → Add to Photos')
  }

  /**
   * Save the QR as PNG across platforms:
   * - Capacitor Android/iOS → Photos/Gallery (PNG)
   * - iOS Safari → Share / long-press overlay
   * - Desktop & Android Chrome → direct .png download
   */
  const download = async () => {
    const canvas = canvasRef.current

    if (!canvas) {
      toast.error('QR code is not ready')
      return
    }

    const fileName = sanitizeQrFileName(name)

    const blob: Blob | null = await new Promise((resolve) => {
      canvas.toBlob(
        (generatedBlob) => resolve(generatedBlob),
        'image/png',
      )
    })

    if (!blob) {
      toast.error('Could not create QR image')
      return
    }

    const strategy = qrDownloadStrategy()

    if (strategy === CAPACITOR_NATIVE_STRATEGY) {
      try {
        const mode = await savePngOnNativeApp(blob, fileName)
        toast.success(
          mode === 'gallery'
            ? 'QR PNG saved to Photos / Gallery'
            : 'Choose Save Image / Save to Files — not Print (Print makes a PDF)',
        )
      } catch (err: any) {
        if (
          err?.message?.toLowerCase?.().includes('cancel') ||
          err?.code === 'CANCEL'
        ) {
          return
        }

        console.error('Failed to save QR PNG:', err)
        toast.error('Could not save QR PNG')
      }

      return
    }

    if (strategy === 'ios-share-or-overlay') {
      try {
        const file = new File(
          [blob],
          fileName,
          {
            type: 'image/png',
          },
        )

        const payload = {
          files: [file],
          title: fileName,
        }

        if (
          typeof navigator.canShare === 'function' &&
          navigator.canShare(payload)
        ) {
          await navigator.share(payload)

          toast.success(
            'Use Save Image / Save to Files — not Print (Print makes a PDF)',
          )

          return
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          return
        }

        console.error(
          'iOS image sharing failed:',
          err,
        )
      }

      showIosSaveSheet(blob)

      return
    }

    // Web (desktop + Android Chrome): real PNG file download
    const objectUrl = URL.createObjectURL(blob)

    const a = document.createElement('a')

    a.href = objectUrl
    a.download = fileName
    a.rel = 'noopener'
    a.style.display = 'none'

    document.body.appendChild(a)
    a.click()
    a.remove()

    setTimeout(() => {
      URL.revokeObjectURL(objectUrl)
    }, 2_000)

    toast.success('QR PNG downloaded')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">
          QR Code
        </h1>

        <p className="text-sm text-gray-500 mt-1">
          Display this QR at your business so customers
          can book instantly.
        </p>
      </div>

      <div className="max-w-sm bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 space-y-4">
        {loading ? (
          <div className="skeleton h-64 w-64 mx-auto" />
        ) : (
          <>
            <div className="flex justify-center bg-white rounded-xl p-4">
              <canvas
                ref={canvasRef}
                className="w-64 h-64"
              />
            </div>

            <div>
              <p className="font-medium text-center">
                {name}
              </p>

              <p className="text-xs text-gray-400 text-center mt-1 break-all">
                {url}
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  navigator.clipboard
                    .writeText(url)
                    .then(() => {
                      toast.success('Link copied!')
                    })
                    .catch(() => {
                      toast.error('Could not copy link')
                    })
                }}
                className="flex-1 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Copy Link
              </button>

              <button
                onClick={() => void download()}
                className="flex-1 py-2.5 bg-primary hover:bg-primary-dark text-white rounded-lg text-sm font-medium"
              >
                Save PNG
              </button>
            </div>
          </>
        )}
      </div>

      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 text-sm">
        <p className="font-medium text-amber-700 dark:text-amber-400 mb-1">
          💡 Tips
        </p>

        <ul className="text-amber-600 dark:text-amber-500 space-y-1 list-disc list-inside">
          <li>
            Place it at the reception or on mirrors/desks.
          </li>

          <li>
            The link uses a secure, opaque code that resolves
            to exactly your business.
          </li>

          <li>
            Bookings made from this QR are tracked as{' '}
            <strong>QR</strong> source in analytics.
          </li>

          <li>
            <strong>App (Android/iOS):</strong> Save PNG stores an image
            in Photos / Gallery — not a PDF.
          </li>
          <li>
            <strong>Web:</strong> downloads a <strong>.png</strong> file.
          </li>
          <li>
            If a share sheet appears, choose <strong>Save Image</strong> /
            Files — avoid <strong>Print</strong> (that creates a PDF).
          </li>
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
            <p className="text-sm font-medium text-center">
              Long-press the QR → Add to Photos
            </p>

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
