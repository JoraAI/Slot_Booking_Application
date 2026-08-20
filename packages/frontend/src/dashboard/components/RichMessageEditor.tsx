import React, { useEffect, useRef } from 'react'

const FONTS = [
  { label: 'Sans', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Serif', value: 'Georgia, Times New Roman, serif' },
  { label: 'Mono', value: 'Courier New, monospace' },
]

const SIZES = [
  { label: 'S', value: '3' },
  { label: 'M', value: '4' },
  { label: 'L', value: '5' },
]

const COLORS = ['#111827', '#7C3AED', '#DC2626', '#059669', '#2563EB', '#D97706']

interface RichMessageEditorProps {
  valueHtml: string
  onChange: (html: string, plain: string) => void
  placeholder?: string
}

function toPlain(html: string): string {
  const el = document.createElement('div')
  el.innerHTML = html
  return (el.innerText || el.textContent || '').replace(/\u00a0/g, ' ').trim()
}

export const RichMessageEditor: React.FC<RichMessageEditorProps> = ({
  valueHtml,
  onChange,
  placeholder = 'Write the message customers should receive',
}) => {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    if (ref.current.innerHTML !== valueHtml) {
      ref.current.innerHTML = valueHtml || ''
    }
  }, [valueHtml])

  const emit = () => {
    const html = ref.current?.innerHTML || ''
    onChange(html, toPlain(html))
  }

  const run = (command: string, value?: string) => {
    ref.current?.focus()
    document.execCommand(command, false, value)
    emit()
  }

  const btn = 'px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800">
      <div className="flex flex-wrap items-center gap-1.5 p-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
        <button type="button" className={`${btn} font-bold`} onMouseDown={(e) => { e.preventDefault(); run('bold') }}>B</button>
        <button type="button" className={`${btn} italic`} onMouseDown={(e) => { e.preventDefault(); run('italic') }}>I</button>
        <button type="button" className={`${btn} underline`} onMouseDown={(e) => { e.preventDefault(); run('underline') }}>U</button>
        <select
          className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
          defaultValue=""
          onChange={(e) => {
            if (!e.target.value) return
            run('fontName', e.target.value)
            e.target.value = ''
          }}
        >
          <option value="" disabled>Font</option>
          {FONTS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
        </select>
        <select
          className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
          defaultValue=""
          onChange={(e) => {
            if (!e.target.value) return
            run('fontSize', e.target.value)
            e.target.value = ''
          }}
        >
          <option value="" disabled>Size</option>
          {SIZES.map((s) => <option key={s.label} value={s.value}>{s.label}</option>)}
        </select>
        <div className="flex items-center gap-1 ml-1">
          {COLORS.map((color) => (
            <button
              key={color}
              type="button"
              title={color}
              className="w-5 h-5 rounded-full border border-gray-300"
              style={{ backgroundColor: color }}
              onMouseDown={(e) => { e.preventDefault(); run('foreColor', color) }}
            />
          ))}
        </div>
      </div>
      <div
        ref={ref}
        contentEditable
        role="textbox"
        aria-multiline="true"
        suppressContentEditableWarning
        onInput={emit}
        data-placeholder={placeholder}
        className="min-h-[140px] px-3 py-2 text-sm focus:outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-gray-400"
      />
      <p className="px-3 py-1.5 text-[11px] text-gray-400 border-t border-gray-100 dark:border-gray-800">
        Formatting applies to email. WhatsApp receives a plain-text version of the same message.
      </p>
    </div>
  )
}
