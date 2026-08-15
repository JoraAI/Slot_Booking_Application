import React, { useRef, useState } from 'react'
import { api } from '../../lib/api'
import toast from 'react-hot-toast'

/**
 * Cloudinary upload button.
 *
 * Fetches a short-lived signed upload signature from the backend
 * (`POST /api/owner/media/signature`) — the API secret never leaves the
 * server — then uploads the file directly to Cloudinary from the browser.
 *
 * When Cloudinary is not configured the signature endpoint returns 503 and the
 * user gets a clear error; text-based configuration remains fully usable.
 */
export const MediaUploadButton: React.FC<{
  onUploaded: (secureUrl: string, publicId: string) => void
  label?: string
  accept?: string
  small?: boolean
}> = ({ onUploaded, label = '📤 Upload', accept = 'image/jpeg,image/png,image/webp', small }) => {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const handleFile = async (file: File) => {
    setUploading(true)
    try {
      let signature
      try {
        signature = await api.getMediaSignature()
      } catch (e: any) {
        toast.error(
          e?.status === 503
            ? 'Media upload is not configured for this workspace. Add Cloudinary credentials on the server, or paste an image URL below.'
            : e?.message || 'Could not reach the media upload service'
        )
        return
      }

      if (file.size > signature.maxFileSizeBytes) {
        toast.error(`Image too large (max ${Math.round(signature.maxFileSizeBytes / 1024 / 1024)}MB)`)
        return
      }

      const body = new FormData()
      body.append('file', file)
      body.append('cloud_name', signature.cloudName)
      body.append('api_key', signature.apiKey)
      body.append('timestamp', String(signature.timestamp))
      body.append('folder', signature.folder)
      body.append('signature', signature.signature)

      const res = await fetch(`https://api.cloudinary.com/v1_1/${signature.cloudName}/auto/upload`, { method: 'POST', body })
      const data = await res.json()
      if (!res.ok || !data.secure_url) {
        throw new Error(data?.error?.message || 'Upload failed')
      }
      onUploaded(data.secure_url, data.public_id)
      toast.success('Image uploaded')
    } catch (e: any) {
      toast.error(e.message || 'Upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
        }}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
        className={
          small
            ? 'px-2.5 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50'
            : 'px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50'
        }
      >
        {uploading ? 'Uploading…' : label}
      </button>
    </>
  )
}
