import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { isNativePlatform } from '../../lib/native'
import { useStore } from '../../store'
import toast from 'react-hot-toast'

const TIMEZONES = [
  'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Kuala_Lumpur',
  'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney', 'Europe/London',
  'Europe/Paris', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'UTC',
]

const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || ''

type SignupStep = 'email' | 'otp' | 'details'
type ForgotStep = 'email' | 'otp' | 'newpass'

declare global {
  interface Window { google?: any }
}

export const LoginPage: React.FC = () => {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [forgotOpen, setForgotOpen] = useState(false)
  const [signupStep, setSignupStep] = useState<SignupStep>('email')
  const [forgotStep, setForgotStep] = useState<ForgotStep>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [timezone, setTimezone] = useState('Asia/Kolkata')
  const [signupToken, setSignupToken] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [googlePending, setGooglePending] = useState<{ googleSignupToken: string; email: string; name: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [resendCountdown, setResendCountdown] = useState(0)
  const googleBtnRef = useRef<HTMLDivElement>(null)
  const { setConfig, setIsAuthenticated } = useStore()
  const navigate = useNavigate()

  const afterAuth = async (token: string) => {
    api.setToken(token)
    try {
      const config = await api.getOwnerMe()
      setConfig(config)
    } catch { /* non-critical; DashboardLayout retries */ }
    setIsAuthenticated(true)
    navigate('/dashboard')
  }

  // Google Identity Services button (login view only). Skip on native WebView —
  // GIS often fails in Capacitor; email/password (and OTP signup) remain available.
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || mode !== 'login' || isNativePlatform()) return
    let cancelled = false
    const render = () => {
      if (cancelled || !googleBtnRef.current || !window.google?.accounts) return
      try {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response: any) => { void handleGoogleCredential(response?.credential) },
        })
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill',
        })
      } catch { /* GIS blocked locally — button stays hidden; backend verify is wired */ }
    }
    if (window.google?.accounts) render()
    else {
      const s = document.createElement('script')
      s.src = 'https://accounts.google.com/gsi/client'
      s.async = true
      s.defer = true
      s.onload = render
      document.head.appendChild(s)
    }
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, GOOGLE_CLIENT_ID])

  useEffect(() => {
    if (resendCountdown <= 0) return
    const t = window.setTimeout(() => setResendCountdown((c) => c - 1), 1000)
    return () => window.clearTimeout(t)
  }, [resendCountdown])

  const handleGoogleCredential = async (credential: string) => {
    if (!credential) { toast.error('Google sign-in did not return a credential'); return }
    setLoading(true)
    try {
      const res = await api.ownerGoogleAuth(credential)
      if (!res.needsSignupCompletion && res.token) {
        toast.success('Signed in with Google!')
        await afterAuth(res.token)
        return
      }
      if (res.needsSignupCompletion && res.googleSignupToken) {
        setEmail(res.email || '')
        setName(res.name || '')
        setGooglePending({ googleSignupToken: res.googleSignupToken, email: res.email || '', name: res.name || '' })
        setSignupStep('details')
        setMode('signup')
        return
      }
      toast.error('Google sign-in could not continue')
    } catch (err: any) {
      toast.error(err.message || 'Google sign-in failed')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      if (mode === 'login') {
        const result = await api.ownerLogin(email, password)
        await afterAuth(result.token)
      }
    } catch (err: any) {
      toast.error(err.message || 'Login failed')
    } finally { setLoading(false) }
  }

  const sendSignupOtp = async () => {
    setLoading(true)
    try {
      await api.ownerSignupRequestOtp(email)
      setSignupStep('otp'); setCode(''); setResendCountdown(60)
      toast.success('Verification code sent to your email')
    } catch (err: any) { toast.error(err.message || 'Could not send the code') }
    finally { setLoading(false) }
  }

  const verifySignupOtp = async () => {
    setLoading(true)
    try {
      const res = await api.ownerSignupVerifyOtp(email, code)
      setSignupToken(res.signupToken); setSignupStep('details')
    } catch (err: any) { toast.error(err.message || 'Invalid code') }
    finally { setLoading(false) }
  }

  const completeSignup = async () => {
    if (password.length < 8 && !googlePending) { toast.error('Password must be at least 8 characters'); return }
    setLoading(true)
    try {
      if (googlePending) {
        const res = await api.ownerGoogleComplete(googlePending.googleSignupToken, name, timezone)
        toast.success('Business workspace created! 🎉')
        await afterAuth(res.token)
        return
      }
      const result = await api.ownerSignup({ signupToken, name, ownerPassword: password, timezone })
      toast.success('Business workspace created! 🎉')
      await afterAuth(result.token)
    } catch (err: any) { toast.error(err.message || 'Sign up failed') }
    finally { setLoading(false) }
  }

  const sendForgotOtp = async () => {
    setLoading(true)
    try {
      await api.ownerForgotRequestOtp(email)
      setForgotStep('otp'); setCode(''); setResendCountdown(60)
      toast.success('If an account exists, a verification code was sent to your email')
    } catch (err: any) { toast.error(err.message || 'Could not send the code') }
    finally { setLoading(false) }
  }

  const verifyForgotOtp = async () => {
    setLoading(true)
    try {
      const res = await api.ownerForgotVerifyOtp(email, code)
      setResetToken(res.resetToken); setForgotStep('newpass')
    } catch (err: any) { toast.error(err.message || 'Invalid code') }
    finally { setLoading(false) }
  }

  const resetPassword = async () => {
    if (password.length < 8) { toast.error('Password must be at least 8 characters'); return }
    setLoading(true)
    try {
      await api.ownerForgotReset(resetToken, password)
      toast.success('Password updated — sign in with your new password')
      setForgotOpen(false); setForgotStep('email'); setPassword('')
    } catch (err: any) { toast.error(err.message || 'Could not reset the password') }
    finally { setLoading(false) }
  }

  const inputCls = 'w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white dark:bg-gray-800'

  const signupTitle =
    signupStep === 'email' ? 'Verify your email'
      : signupStep === 'otp' ? 'Enter the verification code'
        : googlePending ? 'Finish your Google signup' : 'Create your workspace'

  const forgotTitle =
    forgotStep === 'email' ? 'Reset your password'
      : forgotStep === 'otp' ? 'Enter the verification code'
        : 'Choose a new password'

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary to-primary-dark p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center text-white font-bold text-xl mx-auto mb-3">R</div>
          <h1 className="text-2xl font-bold">Reservly</h1>
          <p className="text-sm text-gray-500 mt-1">
            {forgotOpen
              ? forgotTitle
              : mode === 'login'
                ? (signupStep === 'details' ? signupTitle : 'Sign in to your dashboard')
                : signupTitle}
          </p>
        </div>

        {!forgotOpen && (
          <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1 mb-5">
            <button onClick={() => { setMode('login'); setSignupStep('email'); setGooglePending(null) }} className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${mode === 'login' && signupStep !== 'details' ? 'bg-white dark:bg-gray-700 shadow-sm' : 'text-gray-500'}`}>Sign In</button>
            <button onClick={() => { setMode('signup'); setSignupStep('email') }} className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${mode === 'signup' && signupStep !== 'details' ? 'bg-white dark:bg-gray-700 shadow-sm' : 'text-gray-500'}`}>Create Business</button>
          </div>
        )}

        {mode === 'login' && signupStep !== 'details' && !forgotOpen && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" className={inputCls} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium">Password</label>
                <button type="button" onClick={() => { setForgotOpen(true); setForgotStep('email') }} className="text-xs text-primary hover:underline">
                  Forgot password?
                </button>
              </div>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" className={inputCls} />
            </div>
            <button type="submit" disabled={loading} className="w-full py-2.5 bg-primary hover:bg-primary-dark text-white rounded-lg font-medium text-sm disabled:opacity-50">
              {loading ? 'Please wait...' : 'Sign In'}
            </button>
          </form>
        )}

        {mode === 'login' && !forgotOpen && GOOGLE_CLIENT_ID && !isNativePlatform() && (
          <div className="mt-4">
            <div className="flex items-center gap-3 my-3">
              <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
              <span className="text-xs text-gray-400">or</span>
              <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
            </div>
            <div ref={googleBtnRef} className="flex justify-center" />
          </div>
        )}

        {forgotOpen && (
          <div className="space-y-4">
            {forgotStep === 'email' && (
              <>
                <p className="text-sm text-gray-500">Enter the email on your account. We'll send a one-time code to reset your password.</p>
                <div>
                  <label className="block text-sm font-medium mb-1">Email</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
                </div>
                <button onClick={sendForgotOtp} disabled={loading || !email} className="w-full py-2.5 bg-primary hover:bg-primary-dark text-white rounded-lg font-medium text-sm disabled:opacity-50">
                  {loading ? 'Please wait...' : 'Send code'}
                </button>
              </>
            )}
            {forgotStep === 'otp' && (
              <>
                <p className="text-sm text-gray-500">Enter the 6-digit code sent to {email}.</p>
                <div>
                  <label className="block text-sm font-medium mb-1">Verification code</label>
                  <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" className={inputCls} placeholder="123456" />
                </div>
                <button onClick={verifyForgotOtp} disabled={loading || code.length !== 6} className="w-full py-2.5 bg-primary hover:bg-primary-dark text-white rounded-lg font-medium text-sm disabled:opacity-50">
                  {loading ? 'Please wait...' : 'Verify code'}
                </button>
              </>
            )}
            {forgotStep === 'newpass' && (
              <>
                <p className="text-sm text-gray-500">Choose a new password (at least 8 characters).</p>
                <div>
                  <label className="block text-sm font-medium mb-1">New password</label>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className={inputCls} />
                </div>
                <button onClick={resetPassword} disabled={loading || password.length < 8} className="w-full py-2.5 bg-primary hover:bg-primary-dark text-white rounded-lg font-medium text-sm disabled:opacity-50">
                  {loading ? 'Please wait...' : 'Set new password'}
                </button>
              </>
            )}
            <button type="button" onClick={() => setForgotOpen(false)} className="w-full text-center text-sm text-gray-500 hover:underline">
              Back to sign in
            </button>
          </div>
        )}

        {mode === 'signup' && (
          <div className="space-y-4">
            {signupStep === 'email' && (
              <>
                <p className="text-sm text-gray-500">We'll email you a one-time verification code, then you create your workspace.</p>
                <div>
                  <label className="block text-sm font-medium mb-1">Work email</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
                </div>
                <button onClick={sendSignupOtp} disabled={loading || !email} className="w-full py-2.5 bg-primary hover:bg-primary-dark text-white rounded-lg font-medium text-sm disabled:opacity-50">
                  {loading ? 'Please wait...' : 'Send verification code'}
                </button>
              </>
            )}
            {signupStep === 'otp' && (
              <>
                <p className="text-sm text-gray-500">Enter the 6-digit code sent to {email}.</p>
                <div>
                  <label className="block text-sm font-medium mb-1">Verification code</label>
                  <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" className={inputCls} placeholder="123456" />
                </div>
                <button onClick={verifySignupOtp} disabled={loading || code.length !== 6} className="w-full py-2.5 bg-primary hover:bg-primary-dark text-white rounded-lg font-medium text-sm disabled:opacity-50">
                  {loading ? 'Please wait...' : 'Verify code'}
                </button>
                <button onClick={sendSignupOtp} disabled={loading || resendCountdown > 0}
                  className="w-full text-center text-sm text-gray-500 hover:underline">
                  {resendCountdown > 0 ? `Resend code in ${resendCountdown}s` : 'Resend code'}
                </button>
              </>
            )}
            {signupStep === 'details' && (
              <>
                {googlePending && (
                  <p className="text-sm text-gray-500">
                    You're signed in with Google ({googlePending.email}). Pick a name and timezone to create your workspace.
                  </p>
                )}
                <div>
                  <label className="block text-sm font-medium mb-1">Business Name</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Glow Salon" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Timezone</label>
                  <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={inputCls}>
                    {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                  </select>
                </div>
                {!googlePending && (
                  <div>
                    <label className="block text-sm font-medium mb-1">Password</label>
                    <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" className={inputCls} />
                  </div>
                )}
                <button onClick={completeSignup} disabled={loading || !name || name.trim().length < 2 || (!googlePending && password.length < 8)}
                  className="w-full py-2.5 bg-primary hover:bg-primary-dark text-white rounded-lg font-medium text-sm disabled:opacity-50">
                  {loading ? 'Please wait...' : 'Create Workspace'}
                </button>
                {googlePending && (
                  <p className="text-xs text-gray-500">You can add a password later in Settings → Account.</p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
