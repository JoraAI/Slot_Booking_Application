import React, { useEffect, useState } from 'react'

/**
 * Full-screen HTML viewer for invoices — works on web and Capacitor WebView
 * where blob: window.open often fails.
 */
export const HtmlDocumentOverlay: React.FC = () => {
  const [doc, setDoc] = useState<{ html: string; title: string } | null>(null)

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ html: string; title?: string }>).detail
      if (detail?.html) setDoc({ html: detail.html, title: detail.title || 'Document' })
    }
    window.addEventListener('reservly:open-html', onOpen)
    return () => window.removeEventListener('reservly:open-html', onOpen)
  }, [])

  useEffect(() => {
    if (!doc) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDoc(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doc])

  if (!doc) return null

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex flex-col">
      <div className="flex items-center justify-between gap-3 bg-white dark:bg-gray-900 px-4 py-3 border-b border-gray-200 dark:border-gray-800 shrink-0">
        <h2 className="font-semibold text-sm truncate">{doc.title}</h2>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              try {
                const frame = document.getElementById('reservly-html-frame') as HTMLIFrameElement | null
                frame?.contentWindow?.print()
              } catch { /* ignore */ }
            }}
            className="text-sm px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg"
          >
            Print
          </button>
          <button type="button" onClick={() => setDoc(null)} className="text-sm px-3 py-1.5 bg-primary text-white rounded-lg">
            Close
          </button>
        </div>
      </div>
      <iframe
        id="reservly-html-frame"
        title={doc.title}
        srcDoc={doc.html}
        className="flex-1 w-full bg-white border-0"
        sandbox="allow-same-origin allow-modals allow-scripts"
      />
    </div>
  )
}
