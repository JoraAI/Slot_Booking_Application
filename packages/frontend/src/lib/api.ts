import type { PublicConfig, BusinessConfig, TimeSlot, AvailabilityResult, Booking, WaitlistEntry, BlockedSlot, AnalyticsData, Service, ServiceCategory, PageSection, StaffWorkingHour, RefundResult, FormField, CustomerContact, CustomerNotification } from '../types'

// Split-host friendly API base:
// - Local development / single-service deploys: relative `/api` (vite proxies it).
// - Vercel static + external Node API: set VITE_API_BASE_URL to the API origin
//   (e.g. https://reservly-api.onrender.com) OR origin + `/api`. Never put secrets
//   in VITE_* — these vars are exposed to the browser at build time.
function resolveApiBase(): string {
  const raw = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '')
  if (!raw) return '/api'
  // Same-origin `/api` is always correct: Vite proxies it in dev, Vercel
  // rewrites it to the Render API in production. A VITE value that points at
  // the frontend host would fetch index.html and break JSON parsing.
  try {
    const resolved = raw.endsWith('/api') ? raw : `${raw}/api`
    if (typeof window !== 'undefined') {
      const target = new URL(resolved, window.location.origin)
      if (target.origin === window.location.origin) return '/api'
    }
    return resolved
  } catch {
    return '/api'
  }
}
const API_BASE: string = resolveApiBase()

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
    if (res.status === 204) return undefined as T

    const body = await res.text()
    let data: any = null
    try {
      data = body ? JSON.parse(body) : {}
    } catch {
      const returnedHtml = /^\s*</.test(body)
      const message = returnedHtml
        ? 'The API returned a web page instead of data. Redeploy the backend and verify VITE_API_BASE_URL points to the backend host. Contact admin@staffingpros.tech if you need help.'
        : 'The API returned an invalid response. Please try again or contact admin@staffingpros.tech.'
      throw new ApiError(res.status, message, { contentType: res.headers.get('content-type') })
    }

    if (!res.ok) throw new ApiError(res.status, data.error || 'Request failed', data)
    return data as T
  }

  // ---------- Public endpoints ----------

  getConfig(identifier: string) {
    return this.request<PublicConfig>(`/${identifier}/config`)
  }

  getAvailability(identifier: string, date: string, serviceId: string, staffId?: string) {
    const params = new URLSearchParams({ date, serviceId })
    if (staffId) params.set('staffId', staffId)
    return this.request<AvailabilityResult>(`/${identifier}/availability?${params}`)
  }

  getLegacyAvailability(identifier: string, date: string, staffId?: string) {
    const params = new URLSearchParams({ date })
    if (staffId) params.set('staffId', staffId)
    return this.request<TimeSlot[]>(`/${identifier}/availability?${params}`)
  }

  createBooking(identifier: string, data: Record<string, unknown>) {
    return this.request<Booking>(`/${identifier}/bookings`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  createRecurringBooking(identifier: string, data: Record<string, unknown>) {
    return this.request<{ bookings: Booking[]; recurringGroupId: string; conflicts: { date: string; reason: string }[] }>(
      `/${identifier}/recurring`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    )
  }

  // ---------- Customer booking management (token + optional OTP) ----------

  manageSession(identifier: string, bookingId: string, token: string) {
    return this.request<{ otpRequired: boolean; sessionToken?: string; booking?: any }>(`/${identifier}/bookings/${bookingId}/manage/session`, {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
  }

  manageRequestOtp(identifier: string, bookingId: string, token: string) {
    return this.request<{ maskedDestination: string; expiresInMinutes: number }>(`/${identifier}/bookings/${bookingId}/manage/otp/request`, {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
  }

  manageVerifyOtp(identifier: string, bookingId: string, token: string, code: string) {
    return this.request<{ sessionToken: string; booking: any }>(`/${identifier}/bookings/${bookingId}/manage/otp/verify`, {
      method: 'POST',
      body: JSON.stringify({ token, code }),
    })
  }

  manageGetBooking(identifier: string, bookingId: string, sessionToken: string) {
    return this.request<{ booking: any }>(`/${identifier}/bookings/${bookingId}/manage`, {
      headers: { 'X-Booking-Session': sessionToken },
    })
  }

  manageCancelBooking(identifier: string, bookingId: string, sessionToken: string) {
    return this.request<{ success: boolean; booking: any; refund: RefundResult | null }>(`/${identifier}/bookings/${bookingId}/manage`, {
      method: 'DELETE',
      headers: { 'X-Booking-Session': sessionToken },
    })
  }

  joinWaitlist(identifier: string, data: Record<string, unknown>) {
    return this.request<WaitlistEntry>(`/${identifier}/waitlist`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  leaveWaitlist(identifier: string, id: string) {
    return this.request<void>(`/${identifier}/waitlist/${id}`, { method: 'DELETE' })
  }

  initiatePayment(identifier: string, data: {
    serviceId: string
    date: string
    startTime: string
    staffId?: string | null
    source?: string | null
    customerName: string
    customerPhone: string
    customerEmail?: string | null
    formData?: Record<string, unknown>
  }) {
    return this.request<{ orderId: string; amount: number; currency: string; key: string; name: string; payable?: number; pricing?: any; prefill?: any; free?: boolean; booking?: Booking; attemptId?: string }>(`/${identifier}/payments/initiate`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  verifyPayment(identifier: string, data: {
    razorpay_order_id: string
    razorpay_payment_id: string
    razorpay_signature: string
  }) {
    return this.request<{ success: boolean; booking: Booking; idempotent?: boolean }>(`/${identifier}/payments/verify`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  // ---------- Owner auth ----------

  ownerLogin(email: string, password: string) {
    return this.request<{ token: string; business: { id: string; name: string; slug: string; email: string } }>('/owner/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
  }

  ownerSignup(data: { name: string; ownerEmail: string; ownerPassword: string; timezone?: string }) {
    return this.request<{ token: string; business: { id: string; name: string; slug: string; publicCode: string; email: string } }>('/signup', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  getOwnerMe() {
    return this.request<BusinessConfig>('/owner/me')
  }

  updateOwnerPassword(data: { currentPassword: string; newPassword: string }) {
    return this.request<{ success: boolean }>('/owner/password', {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  getOwnerBookings(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return this.request<{ bookings: Booking[]; total: number; page: number; totalPages: number }>(`/owner/bookings${qs}`)
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

  updateBlockedSlot(id: string, data: Record<string, unknown>) {
    return this.request<BlockedSlot>(`/owner/block/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
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
    return this.request<{ count: number; formFields: FormField[] }>('/owner/form-fields', {
      method: 'PUT',
      body: JSON.stringify({ formFields: fields }),
    })
  }

  getAnalytics(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return this.request<AnalyticsData>(`/owner/analytics${qs}`)
  }

  getCustomers(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return this.request<{ customers: CustomerContact[]; total: number; page: number; totalPages: number }>(`/owner/customers${qs}`)
  }

  createCustomer(data: { name: string; phone?: string | null; email?: string | null; notes?: string | null; lastServiceName?: string | null; lastBookedAt?: string | null }) {
    return this.request<CustomerContact>('/owner/customers', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  updateCustomer(id: string, data: { name: string; phone?: string | null; email?: string | null; notes?: string | null; lastServiceName?: string | null; lastBookedAt?: string | null }) {
    return this.request<CustomerContact>(`/owner/customers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  deleteCustomer(id: string) {
    return this.request<void>(`/owner/customers/${id}`, { method: 'DELETE' })
  }

  notifyCustomer(id: string, data: { channels: ('email' | 'whatsapp')[]; subject: string; message: string }) {
    return this.request<{ results: { channel: 'email' | 'whatsapp'; ok: boolean; error?: string }[] }>(`/owner/customers/${id}/notify`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  sendCustomNotification(data: {
    customerId?: string | null
    name?: string
    phone?: string | null
    email?: string | null
    channels: ('email' | 'whatsapp')[]
    subject: string
    message: string
  }) {
    return this.request<{
      customer: CustomerContact
      results: { channel: 'email' | 'whatsapp'; ok: boolean; error?: string }[]
    }>('/owner/notifications/send', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  sendBroadcastNotification(data: { subject: string; message: string }) {
    return this.request<{
      total: number
      emailed: number
      whatsapped: number
      reached: number
      unsent: Array<{ id: string; name: string; email: string | null; phone: string | null; reason: string }>
      ownerNotified: boolean
    }>('/owner/notifications/broadcast', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  getCustomerNotifications(limit = 25) {
    return this.request<CustomerNotification[]>(`/owner/customer-notifications?limit=${limit}`)
  }

  sendTestNotification() {
    return this.request<{ email: { ok: boolean; error?: string }; whatsapp: { ok: boolean; error?: string } }>('/owner/notify/test', { method: 'POST' })
  }

  getOwnerSettingsStatus() {
    return this.request<{
      smtpConfigured: boolean
      twilioSmsConfigured: boolean
      metaWhatsappConfigured: boolean
      frontendUrlConfigured: boolean
      locationComplete: boolean
      ownerEmailPresent: boolean
      ownerWhatsappPresent: boolean
    }>('/owner/settings/status')
  }

  getOwnerSubscription() {
    return this.request<{
      plan: 'COMMISSION' | 'MONTHLY_799' | 'YEARLY_799'
      status: 'ACTIVE' | 'PAST_DUE'
      isActive: boolean
      dueInr: number
      paidInr: number
      currentMonthKey: string | null
      currentCycleEndsAt: string | null
    }>('/owner/subscription')
  }

  selectOwnerSubscriptionPlan(plan: 'COMMISSION' | 'MONTHLY_799' | 'YEARLY_799') {
    return this.request<{ ok: boolean }>('/owner/subscription/select', {
      method: 'POST',
      body: JSON.stringify({ plan }),
    })
  }

  createSubscriptionPayment() {
    return this.request<{
      alreadyPaid?: boolean
      orderId?: string
      amountInr?: number
      amountPaise?: number
      currency?: string
      keyId?: string
      plan?: string
    }>('/owner/subscription/pay', { method: 'POST', body: JSON.stringify({}) })
  }

  verifySubscriptionPayment(data: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) {
    return this.request<{ ok: boolean; dueInr: number; plan: string }>('/owner/subscription/verify', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  markSubscriptionPaid() {
    return this.request<{ ok: boolean; dueInr: number; plan: string }>('/owner/subscription/mark-paid', {
      method: 'POST',
      body: JSON.stringify({}),
    })
  }

  getWaitlist(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return this.request<{ entries: WaitlistEntry[]; total: number; page: number; totalPages: number }>(`/owner/waitlist${qs}`)
  }

  notifyWaitlistEntry(id: string) {
    return this.request<void>(`/owner/waitlist/${id}/notify`, { method: 'POST' })
  }

  deleteWaitlistEntry(id: string) {
    return this.request<void>(`/owner/waitlist/${id}`, { method: 'DELETE' })
  }

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

  // ---------- Categories & Services (owner) ----------

  getCategories() {
    return this.request<ServiceCategory[]>('/owner/categories')
  }

  createCategory(data: Record<string, unknown>) {
    return this.request<ServiceCategory>('/owner/categories', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  updateCategory(id: string, data: Record<string, unknown>) {
    return this.request<ServiceCategory>(`/owner/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  deleteCategory(id: string) {
    return this.request<void>(`/owner/categories/${id}`, { method: 'DELETE' })
  }

  getServices() {
    return this.request<Service[]>('/owner/services')
  }

  createService(data: Record<string, unknown>) {
    return this.request<Service>('/owner/services', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  updateService(id: string, data: Record<string, unknown>) {
    return this.request<Service>(`/owner/services/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  deleteService(id: string) {
    return this.request<{ success: boolean; softDeleted?: boolean }>(`/owner/services/${id}`, { method: 'DELETE' })
  }

  getServiceHours(id: string) {
    return this.request<{ id: string; serviceId: string; dayOfWeek: number; openTime: string; closeTime: string; isOpen: boolean }[]>(`/owner/services/${id}/hours`)
  }

  updateServiceHours(id: string, hours: Record<string, unknown>[]) {
    return this.request<void>(`/owner/services/${id}/hours`, {
      method: 'PUT',
      body: JSON.stringify({ hours }),
    })
  }

  getStaffHours(id: string) {
    return this.request<StaffWorkingHour[]>(`/owner/staff/${id}/hours`)
  }

  updateStaffHours(id: string, hours: Record<string, unknown>[]) {
    return this.request<void>(`/owner/staff/${id}/hours`, {
      method: 'PUT',
      body: JSON.stringify({ hours }),
    })
  }

  // ---------- Page sections (owner) ----------

  getPageSections() {
    return this.request<PageSection[]>('/owner/page-sections')
  }

  createPageSection(data: Record<string, unknown>) {
    return this.request<PageSection>('/owner/page-sections', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  updatePageSection(id: string, data: Record<string, unknown>) {
    return this.request<PageSection>(`/owner/page-sections/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  deletePageSection(id: string) {
    return this.request<void>(`/owner/page-sections/${id}`, { method: 'DELETE' })
  }

  // ---------- Media (Postgres) ----------

  uploadMedia(data: { mimeType: string; dataBase64: string }) {
    return this.request<{ url: string; publicId: string | null }>('/owner/media/upload', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  // ---------- QR ----------

  getQrInfo() {
    return this.request<{ url: string; publicCode: string; businessName: string }>('/owner/qr')
  }

  // ---------- Payments (owner) ----------

  getPayments(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return this.request<{ bookings: Booking[]; total: number; page: number; totalPages: number }>(`/owner/payments${qs}`)
  }

  refundPayment(id: string, data?: { amount?: number }) {
    return this.request<{ refund: RefundResult; booking: Booking }>(`/owner/payments/${id}/refund`, {
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
