import React from 'react'

interface BusyOverlayProps {
  show: boolean
  message?: string
  /** Cover the whole viewport instead of the nearest positioned parent. */
  fullscreen?: boolean
}

/**
 * Blocking progress overlay for slow async work. The API can cold-start on
 * free hosting, so long waits need visible feedback and must not accept a
 * second submit.
 */
export const BusyOverlay: React.FC<BusyOverlayProps> = ({ show, message = 'Please wait…', fullscreen = false }) => {
  if (!show) return null

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={`${fullscreen ? 'fixed' : 'absolute'} inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-white/75 dark:bg-gray-950/75 backdrop-blur-sm rounded-xl`}
    >
      <span className="w-8 h-8 rounded-full border-2 border-gray-300 dark:border-gray-700 border-t-primary animate-spin" />
      <p className="text-sm font-medium text-gray-600 dark:text-gray-300">{message}</p>
    </div>
  )
}
