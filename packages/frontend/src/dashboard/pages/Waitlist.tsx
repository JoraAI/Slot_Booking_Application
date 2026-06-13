import React from 'react'

export const WaitlistPage: React.FC = () => {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Waitlist</h1>
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
        <p className="text-3xl mb-2">⏳</p>
        <p className="text-gray-500">No waitlist entries yet. When slots are full, customers can join the waitlist.</p>
      </div>
    </div>
  )
}