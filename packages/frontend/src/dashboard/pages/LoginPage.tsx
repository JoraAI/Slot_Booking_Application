import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import toast from 'react-hot-toast'

const TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Kuala_Lumpur',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'UTC',
]

export const LoginPage: React.FC = () => {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [timezone, setTimezone] = useState('Asia/Kolkata')
  const [loading, setLoading] = useState(false)
  const { setConfig, setIsAuthenticated } = useStore()
  const navigate = useNavigate()

  const afterAuth = async (token: string) => {
    api.setToken(token)
    try {
      const config = await api.getOwnerMe()
      setConfig(config)
    } catch {
      // non-critical; DashboardLayout retries
    }
    setIsAuthenticated(true)
    navigate('/dashboard')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      if (mode === 'login') {
        const result = await api.ownerLogin(email, password)
        await afterAuth(result.token)
      } else {
        const result = await api.ownerSignup({ name, ownerEmail: email, ownerPassword: password, timezone })
        toast.success('Business workspace created! 🎉')
        await afterAuth(result.token)
      }
    } catch (err: any) {
      toast.error(err.message || (mode === 'login' ? 'Login failed' : 'Sign up failed'))
    } finally {
      setLoading(false)
    }
  }

  const inputCls = 'w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white dark:bg-gray-800'

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary to-primary-dark p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-8 w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center text-white font-bold text-xl mx-auto mb-3">S</div>
          <h1 className="text-2xl font-bold">SlotBook</h1>
          <p className="text-sm text-gray-500 mt-1">{mode === 'login' ? 'Sign in to your dashboard' : 'Create your booking workspace'}</p>
        </div>

        <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1 mb-6">
          <button onClick={() => setMode('login')} className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${mode === 'login' ? 'bg-white dark:bg-gray-700 shadow-sm' : 'text-gray-500'}`}>Sign In</button>
          <button onClick={() => setMode('signup')} className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${mode === 'signup' ? 'bg-white dark:bg-gray-700 shadow-sm' : 'text-gray-500'}`}>Create Business</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">Business Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Glow Salon" className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Timezone</label>
                <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={inputCls}>
                  {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>
            </>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputCls} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === 'signup' ? 8 : undefined} className={inputCls} />
          </div>
          <button type="submit" disabled={loading} className="w-full py-2.5 bg-primary hover:bg-primary-dark text-white rounded-lg font-medium text-sm disabled:opacity-50">
            {loading ? 'Please wait...' : (mode === 'login' ? 'Sign In' : 'Create Workspace')}
          </button>
        </form>
      </div>
    </div>
  )
}
