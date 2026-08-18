import React, { useRef, useState } from 'react'
import { api } from '../../lib/api'
import toast from 'react-hot-toast'

const MAX_BYTES = 2 * 1024 * 1024

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(new Error('Could not read the image file'))
    reader.readAsDataURL(file)
  })
}

/**
 * Uploads an image to Postgres via POST /owner/media/upload and returns a
 * stable `/api/media/:id` URL for logo, cover, and service fields.
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
      if (file.size > MAX_BYTES) {
        toast.error('Image too large (max 2MB)')
        return
      }
      const dataBase64 = await fileToBase64(file)
      const uploaded = await api.uploadMedia({ mimeType: file.type || 'image/jpeg', dataBase64 })
      onUploaded(uploaded.url, uploaded.publicId || '')
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
