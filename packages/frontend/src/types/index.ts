export interface BusinessConfig {
  id: string
  name: string
  slug: string
  bookingWindowDays: number
  parallelSeats: number
  slotDurationMinutes: number
  showAvailableCount: boolean
  notifyOwnerEmail: boolean
  notifyOwnerWhatsapp: boolean
  notifyCustomerEmail: boolean
  notifyCustomerWhatsapp: boolean
  ownerEmail: string
  ownerWhatsapp: string | null
  enableWaitlist: boolean
  enableRecurring: boolean
  enablePayments: boolean
  enableMultiStaff: boolean
  paymentMode: 'full' | 'deposit' | 'none'
  depositAmount: number | null
  depositPercentage: number | null
  servicePrice: number | null
  razorpayKeyId: string | null
  razorpayTestMode: boolean
  refundPolicy: string | null
  embedAllowedOrigins: string[]
  workingHours: WorkingHour[]
  formFields: FormField[]
  staff: Staff[]
}

export interface WorkingHour {
  id: string
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

export interface TimeSlot {
  time: string
  isAvailable: boolean
  availableSeats?: number
  isBlocked: boolean
  waitlistCount?: number
}

export interface Booking {
  id: string
  businessId: string
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
  paymentStatus: string | null
  paymentAmount: number | null
  razorpayOrderId: string | null
  razorpayPaymentId: string | null
  createdAt: string
  updatedAt: string
  cancelledAt: string | null
}

export type BookingStatus = 'CONFIRMED' | 'CANCELLED' | 'RESCHEDULED' | 'COMPLETED' | 'NO_SHOW'

export interface WaitlistEntry {
  id: string
  businessId: string
  date: string
  startTime: string
  customerName: string
  customerPhone: string
  customerEmail: string | null
  staffId: string | null
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
  statusBreakdown: Record<BookingStatus, number>
  heatmap: { day: number; hour: number; count: number }[]
  trend: { date: string; count: number }[]
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
}

export interface BookingWizardState {
  currentStep: number
  steps: string[]
  selectedStaff: string | null
  selectedDate: string | null
  selectedTime: string | null
  formData: Record<string, string | boolean | number>
  isRecurring: boolean
  recurringFrequency: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY'
  recurringCount: number
  recurringSkipDates: string[]
  paymentOrderId: string | null
  paymentAmount: number | null
}