import { create } from 'zustand'
import type { BusinessConfig, PublicConfig, BookingWizardState } from '../types'

interface AppState {
  // Owner business config (dashboard)
  config: BusinessConfig | null
  setConfig: (config: BusinessConfig) => void

  // Public config (customer widget)
  publicConfig: PublicConfig | null
  setPublicConfig: (config: PublicConfig) => void

  // Owner auth
  isAuthenticated: boolean
  setIsAuthenticated: (v: boolean) => void

  // Booking wizard
  wizard: BookingWizardState
  setWizard: (partial: Partial<BookingWizardState>) => void
  resetWizard: () => void

  // Embed mode
  isEmbedded: boolean
  setIsEmbedded: (v: boolean) => void
}

const initialWizard: BookingWizardState = {
  currentStep: 0,
  steps: [],
  selectedCategoryId: null,
  selectedServiceId: null,
  selectedStaff: null,
  selectedDate: null,
  selectedTime: null,
  source: 'DIRECT',
  displayedPricing: null,
  formData: {},
  isRecurring: false,
  recurringFrequency: 'WEEKLY',
  recurringCount: 4,
  recurringSkipDates: [],
  paymentOrderId: null,
  paymentAmount: null,
}

export const useStore = create<AppState>((set) => ({
  config: null,
  setConfig: (config) => set({ config }),

  publicConfig: null,
  setPublicConfig: (publicConfig) => set({ publicConfig }),

  isAuthenticated: !!localStorage.getItem('owner_token'),
  setIsAuthenticated: (isAuthenticated) => set({ isAuthenticated }),

  wizard: initialWizard,
  setWizard: (partial) => set((state) => ({ wizard: { ...state.wizard, ...partial } })),
  resetWizard: () => set({ wizard: { ...initialWizard, source: 'DIRECT' } }),

  isEmbedded: false,
  setIsEmbedded: (isEmbedded) => set({ isEmbedded }),
}))
