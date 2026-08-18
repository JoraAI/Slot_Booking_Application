export interface LocationInfo {
  address: string | null
  latitude: number | null
  longitude: number | null
  directionsUrl: string | null
}

export interface BusinessConfig {
  id: string
  name: string
  slug: string
  publicCode: string
  timezone: string
  description: string | null
  logoUrl: string | null
  logoPublicId: string | null
  coverImageUrl: string | null
  coverImagePublicId: string | null
  primaryColor: string
  secondaryColor: string | null
  accentColor: string | null
  slotGranularityMinutes: number
  reminderOffsetsMinutes: number[]
  remindersEnabled: boolean
  bookingManagementOtpEnabled: boolean
  bookingManagementOtpChannel: string | null
  bookingWindowDays: number
  minBookingNoticeHours: number
  showAvailableCount: boolean
  notifyOwnerEmail: boolean
  notifyOwnerWhatsapp: boolean
  notifyCustomerEmail: boolean
  notifyCustomerWhatsapp: boolean
  ownerEmail: string
  ownerWhatsapp: string | null
  smtpHost: string | null
  smtpPort: number | null
  smtpSecure: boolean
  smtpUser: string | null
  smtpFromName: string | null
  smtpPassConfigured?: boolean
  smtpConfigured?: boolean
  metaWhatsappPhoneNumberId: string | null
  metaWhatsappBusinessAccountId: string | null
  metaWhatsappTemplateUtility: string | null
  metaWhatsappTemplateMarketing: string | null
  metaWhatsappAccessTokenConfigured?: boolean
  metaWhatsappConfigured?: boolean
  twilioAccountSid: string | null
  twilioSmsFrom: string | null
  twilioAuthTokenConfigured?: boolean
  twilioSmsConfigured?: boolean
  subscriptionPlan: 'COMMISSION' | 'MONTHLY_799'
  subscriptionCommissionPercent: number | null
  subscriptionMonthlyInr: number
  enableWaitlist: boolean
  enableRecurring: boolean
  enablePayments: boolean
  enableMultiStaff: boolean
  paymentMode: 'full' | 'deposit' | 'none'
  depositAmount: number | null
  depositPercentage: number | null
  razorpayKeyId: string | null
  razorpayKeySecretConfigured?: boolean
  razorpayTestMode: boolean
  refundPolicy: string | null
  embedAllowedOrigins: string[]
  address: string | null
  latitude: number | null
  longitude: number | null
  workingHours: WorkingHour[]
  formFields: FormField[]
  staff: Staff[]
  serviceCategories: ServiceCategory[]
  services: Service[]
  pageSections: PageSection[]
  staffWorkingHours: StaffWorkingHour[]
}

export interface PublicConfig {
  business: {
    id: string
    name: string
    slug: string
    publicCode: string
    timezone: string
    description: string | null
    bookingWindowDays: number
    minBookingNoticeHours: number
    showAvailableCount: boolean
    branding: {
      logoUrl: string | null
      coverImageUrl: string | null
      primaryColor: string
      secondaryColor: string | null
      accentColor: string | null
    }
    location: LocationInfo
  }
  serviceCategories: ServiceCategory[]
  services: Service[]
  pageSections: PageSection[]
  workingHours: WorkingHour[]
  staff: Staff[]
  formFields: FormField[]
  featureFlags: {
    waitlist: boolean
    recurring: boolean
    payments: boolean
    multiStaff: boolean
  }
  payment: {
    mode: 'full' | 'deposit' | 'none'
    depositAmount: number | null
    depositPercentage: number | null
    testMode: boolean
    refundPolicy: string | null
  }
}

export interface CustomerContact {
  id: string
  businessId: string
  name: string
  phone: string | null
  email: string | null
  notes: string | null
  bookingCount: number
  lastBookedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CustomerNotification {
  id: string
  customerId: string | null
  channel: 'email' | 'whatsapp'
  subject: string | null
  message: string
  recipientName: string
  recipientEmail: string | null
  recipientPhone: string | null
  status: 'SENT' | 'FAILED'
  error: string | null
  sentAt: string | null
  createdAt: string
}

export type ResourceMode = 'STAFF_BASED' | 'POOLED'
export type DiscountType = 'PERCENTAGE' | 'FLAT'
export type BookingSource = 'DIRECT' | 'QR' | 'EMBED' | 'WIDGET'
export type PageSectionType = 'HERO' | 'OFFERS' | 'GALLERY' | 'ABOUT' | 'SERVICES' | 'BUSINESS_HOURS' | 'WHY_CHOOSE_US' | 'TESTIMONIALS' | 'CONTACT' | 'CUSTOM_TEXT'

export interface WorkingHour {
  id: string
  dayOfWeek: number
  openTime: string
  closeTime: string
  isOpen: boolean
}

export interface StaffWorkingHour {
  id: string
  businessId: string
  staffId: string
  dayOfWeek: number
  openTime: string
  closeTime: string
  isOpen: boolean
}

export interface FormField {
  id: string
  label: string
  fieldType: 'text' | 'number' | 'select' | 'checkbox' | 'tel' | 'email' | 'textarea'
  required: boolean
  options: string[]
  placeholder?: string
  order: number
  visible: boolean
}

export interface Staff {
  id: string
  name: string
  role: string | null
  phone: string | null
  email: string | null
  color: string
  isActive: boolean
}

export interface ServiceCategory {
  id: string
  businessId: string
  name: string
  description: string | null
  imageUrl: string | null
  displayOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface Service {
  id: string
  businessId: string
  categoryId: string
  category?: { id: string; name: string }
  name: string
  description: string | null
  durationMinutes: number
  bufferMinutes: number
  price: number
  resourceMode: ResourceMode
  capacity: number
  isActive: boolean
  displayOrder: number
  imageUrl: string | null
  discountType: DiscountType | null
  discountValue: number | null
  discountLabel: string | null
  discountActive: boolean
  discountValidFrom: string | null
  discountValidUntil: string | null
  assignedStaffIds?: string[]
  workingHours?: { dayOfWeek: number; openTime: string; closeTime: string; isOpen: boolean }[]
  displayedPricing?: {
    originalPrice: number
    discountAmount: number
    finalPrice: number
    discountLabel: string | null
    discountType: DiscountType | null
  }
  createdAt?: string
  updatedAt?: string
}

export interface PageSection {
  id: string
  businessId: string
  type: PageSectionType
  title: string | null
  content: string | null
  configuration: Record<string, unknown>
  displayOrder: number
  isVisible: boolean
  createdAt: string
  updatedAt: string
}

export interface TimeSlot {
  time: string
  endTime: string
  isAvailable: boolean
  availableSeats?: number
  isBlocked: boolean
  waitlistCount?: number
}

export interface AvailabilitySlot {
  startTime: string
  endTime: string
  eligibleStaffIds: string[]
  availableCapacity: number
}

export interface AvailabilityResult {
  date: string
  serviceId: string
  durationMinutes: number
  bufferMinutes: number
  timezone: string
  slots: AvailabilitySlot[]
  nextAvailable: string | null
}

export interface Booking {
  id: string
  businessId: string
  serviceId: string | null
  service?: Service
  staffId: string | null
  staff?: Staff
  date: string
  startTime: string
  endTime: string
  status: BookingStatus
  formData: Record<string, unknown>
  customerName: string
  customerPhone: string
  customerEmail: string | null
  seatIndex: number
  isRecurring: boolean
  recurringRule: string | null
  recurringGroupId: string | null
  originalPrice: number | null
  discountAmount: number | null
  finalPrice: number | null
  source: BookingSource
  serviceNameSnapshot: string | null
  durationMinutesSnapshot: number | null
  bufferMinutesSnapshot: number | null
  currency: string
  paymentStatus: string | null
  paymentAmount: number | null
  razorpayOrderId: string | null
  razorpayPaymentId: string | null
  /** Singular durable refund pipeline (bookingId unique). */
  paymentRefund?: PaymentRefund | null
  createdAt: string
  updatedAt: string
  cancelledAt: string | null
  /** Plaintext management token — returned exactly once at creation only. */
  managementToken?: string
  managementUrl?: string
}

export type BookingStatus = 'CONFIRMED' | 'CANCELLED' | 'RESCHEDULED' | 'COMPLETED' | 'NO_SHOW'

/** Durable refund pipeline (Batch 2A). One row per booking (`bookingId` unique). */
export interface PaymentRefund {
  id: string
  businessId: string
  bookingId: string
  razorpayPaymentId: string
  razorpayRefundId: string | null
  /** Stable key sent as Razorpay `X-Refund-Idempotency` on every retry. */
  idempotencyKey: string
  amountMinor: number
  currency: string
  status: 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED'
  failureReason: string | null
  initiatedAt: string | null
  processedAt: string | null
  createdAt: string
  updatedAt: string
}

/** Customer-facing refund status returned by the cancel/manage endpoint. */
export interface RefundResult {
  status: 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED'
  amount: number
  amountMinor: number
  razorpayRefundId: string | null
  message: string
  failureReason?: string | null
}

export interface WaitlistEntry {
  id: string
  businessId: string
  serviceId: string | null
  date: string
  startTime: string
  customerName: string
  customerPhone: string
  customerEmail: string | null
  staffId: string | null
  durationMinutesSnapshot: number | null
  source: BookingSource
  formData: Record<string, unknown>
  notified: boolean
  notifiedAt: string | null
  expired: boolean
  createdAt: string
}

export interface BlockedSlot {
  id: string
  businessId: string
  staffId: string | null
  staff?: Staff
  date: string
  startTime: string
  endTime: string
  reason: string | null
  createdAt: string
}

export interface AnalyticsData {
  totalBookings: number
  cancellationRate: number
  peakHour: string
  busiestDay: string
  statusBreakdown: Record<string, number>
  heatmap: Record<string, Record<string, number>>
  trend: Record<string, number>
  sparkline?: number[]
  revenue?: any
  waitlistMetrics?: {
    entries: number
    avgWaitMinutes: number
    conversionRate: number
    topSlots: { date: string; startTime: string; count: number }[]
  }
  recurringMetrics?: {
    percentage: number
    avgSeriesLength: number
    activeSeries: number
    churnRate: number
  }
  staffPerformance?: {
    id: string
    name: string
    totalBookings: number
    completionRate: number
    noShowRate: number
    cancellationRate: number
    busiestDay: string
  }[]
  paymentMetrics?: {
    totalRevenue: number
    depositRevenue: number
    fullPaymentRevenue: number
    refundsCount: number
    refundsAmount: number
    failureRate: number
    revenueByDay: { date: string; amount: number }[]
  }
  revenueMetrics?: {
    totalCollected: number
    totalListed: number
    discountsGiven: number
    avgBookingValue: number
    discountUsageCount: number
  }
  bookingsByService?: { name: string; count: number; revenue: number }[]
  revenueByService?: { name: string; revenue: number }[]
  bookingsByCategory?: { name: string; count: number }[]
  bookingsBySource?: { source: string; count: number }[]
  qrBooking?: { count: number; rate: number }
  popularServices?: { name: string; bookings: number }[]
  avgBookingValue?: number
}

export interface BookingWizardState {
  currentStep: number
  steps: string[]
  selectedCategoryId: string | null
  selectedServiceId: string | null
  selectedStaff: string | null
  selectedDate: string | null
  selectedTime: string | null
  source: BookingSource
  displayedPricing: {
    originalPrice: number
    discountAmount: number
    finalPrice: number
    discountLabel: string | null
  } | null
  formData: Record<string, string | boolean | number>
  isRecurring: boolean
  recurringFrequency: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY'
  recurringCount: number
  recurringSkipDates: string[]
  paymentOrderId: string | null
  paymentAmount: number | null
}
