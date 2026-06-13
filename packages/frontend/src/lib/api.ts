import type { BusinessConfig, TimeSlot, Booking, WaitlistEntry, BlockedSlot, AnalyticsData } from '../types'

const API_BASE = '/api'

class ApiClient {
  private token: string | null = null

  setToken(token: string | null) {
    this.token = token
    if (token) localStorage.setItem('owner_token', token)
    else localStorage.removeItem('owner_token')
  }

  getToken(): string | null {
    if (!this.token) this.token = localStorage.getItem('owner_token')
    return this.token
  }

  private async request<T>(url: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    }
    if (this.getToken()) headers['Authorization'] = `Bearer ${this.getToken()}`

    const res = await fetch(`${API_BASE}${url}`, { ...options, headers })
    const data = await res.json()
    if (!res.ok) throw new ApiError(res.status, data.error || 'Request failed', data)
    return data
  }

  // Public endpoints
  getConfig(slug: string) {
    return this.request<BusinessConfig>(`/${slug}/config`)
  }

  getAvailability(slug: string, date: string, staffId?: string) {
    const params = new URLSearchParams({ date })
    if (staffId) params.set('staffId', staffId)
    return this.request<TimeSlot[]>(`/${slug}/availability?${params}`)
  }

  createBooking(slug: string, data: Record<string, unknown>) {
    return this.request<Booking>(`/${slug}/bookings`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  getBooking(slug: string, id: string) {
    return this.request<Booking>(`/${slug}/bookings/${id}`)
  }

  updateBooking(slug: string, id: string, data: Record<string, unknown>) {
    return this.request<Booking>(`/${slug}/bookings/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  cancelBooking(slug: string, id: string) {
    return this.request<void>(`/${slug}/bookings/${id}`, { method: 'DELETE' })
  }

  joinWaitlist(slug: string, data: Record<string, unknown>) {
    return this.request<WaitlistEntry>(`/${slug}/waitlist`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  leaveWaitlist(slug: string, id: string) {
    return this.request<void>(`/${slug}/waitlist/${id}`, { method: 'DELETE' })
  }

  initiatePayment(slug: string, data: { bookingId?: string; amount: number }) {
    return this.request<{ orderId: string; amount: number; currency: string; key: string; name: string; prefill?: any }>(`/${slug}/payments/initiate`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  verifyPayment(slug: string, data: {
    razorpay_order_id: string
    razorpay_payment_id: string
    razorpay_signature: string
    bookingData?: Record<string, unknown>
  }) {
    return this.request<{ success: boolean; booking: any }>(`/${slug}/payments/verify`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  // Owner endpoints
  getOwnerMe() {
    return this.request<BusinessConfig>('/owner/me')
  }

  ownerLogin(email: string, password: string) {
    return this.request<{ token: string; business: { id: string; name: string; slug: string; email: string } }>('/owner/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
  }

  getOwnerBookings(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return this.request<{ bookings: Booking[]; total: number }>(`/owner/bookings${qs}`)
  }

  getOwnerBooking(id: string) {
    return this.request<Booking>(`/owner/bookings/${id}`)
  }

  updateOwnerBooking(id: string, data: Record<string, unknown>) {
    return this.request<Booking>(`/owner/bookings/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  deleteOwnerBooking(id: string) {
    return this.request<void>(`/owner/bookings/${id}`, { method: 'DELETE' })
  }

  blockSlot(data: Record<string, unknown>) {
    return this.request<BlockedSlot>('/owner/block', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  createBlock(data: Record<string, unknown>) {
    return this.blockSlot(data)
  }

  unblockSlot(id: string) {
    return this.request<void>(`/owner/block/${id}`, { method: 'DELETE' })
  }

  getBlockedSlots(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return this.request<BlockedSlot[]>(`/owner/blocks${qs}`)
  }

  updateConfig(data: Record<string, unknown>) {
    return this.request<BusinessConfig>('/owner/config', {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  updateWorkingHours(hours: Record<string, unknown>[]) {
    return this.request<void>('/owner/working-hours', {
      method: 'PUT',
      body: JSON.stringify({ workingHours: hours }),
    })
  }

  updateFormFields(fields: Record<string, unknown>[]) {
    return this.request<void>('/owner/form-fields', {
      method: 'PUT',
      body: JSON.stringify({ formFields: fields }),
    })
  }

  getAnalytics(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return this.request<AnalyticsData>(`/owner/analytics${qs}`)
  }

  sendTestNotification() {
    return this.request<void>('/owner/notify/test', { method: 'POST' })
  }

  // Waitlist (owner)
  getWaitlist(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return this.request<WaitlistEntry[]>(`/owner/waitlist${qs}`)
  }

  notifyWaitlistEntry(id: string) {
    return this.request<void>(`/owner/waitlist/${id}/notify`, { method: 'POST' })
  }

  deleteWaitlistEntry(id: string) {
    return this.request<void>(`/owner/waitlist/${id}`, { method: 'DELETE' })
  }

  // Staff (owner)
  getStaff() {
    return this.request<import('../types').Staff[]>('/owner/staff')
  }

  createStaff(data: Record<string, unknown>) {
    return this.request<import('../types').Staff>('/owner/staff', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  updateStaff(id: string, data: Record<string, unknown>) {
    return this.request<import('../types').Staff>(`/owner/staff/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  deleteStaff(id: string) {
    return this.request<void>(`/owner/staff/${id}`, { method: 'DELETE' })
  }

  // Payments (owner)
  getPayments(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return this.request<any[]>(`/owner/payments${qs}`)
  }

  refundPayment(id: string, data?: { reason?: string }) {
    return this.request<any>(`/owner/payments/${id}/refund`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    })
  }
}

class ApiError extends Error {
  status: number
  data: any
  constructor(status: number, message: string, data: any) {
    super(message)
    this.status = status
    this.data = data
  }
}

export const api = new ApiClient()
export { ApiError }