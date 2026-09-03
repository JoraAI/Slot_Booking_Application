import React from 'react'

/**
 * Small attribution shown at the bottom for both:
 * - public customer booking pages
 * - the owner dashboard
 */
export const JoraPoweredBy: React.FC = () => {
  return (
    <div className="w-full flex justify-center py-4 text-[11px] text-gray-500 dark:text-gray-400">
      <span className="leading-none">
        Powered by{' '}
        <a
          href="https://jora.co.in"
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-500 hover:text-primary dark:hover:text-primary transition-colors"
        >
          Jora AI
        </a>
      </span>
    </div>
  )
}

