import { create } from 'zustand'
import type { BusinessConfig, BookingWizardState } from '../types'

interface AppState {
  // Business config (for widget)
  config: BusinessConfig | null
  setConfig: (config: BusinessConfig) => void

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
  selectedStaff: null,
  selectedDate: null,
  selectedTime: null,
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

  isAuthenticated: !!localStorage.getItem('owner_token'),
  setIsAuthenticated: (isAuthenticated) => set({ isAuthenticated }),

  wizard: initialWizard,
  setWizard: (partial) => set((state) => ({ wizard: { ...state.wizard, ...partial } })),
  resetWizard: () => set({ wizard: initialWizard }),

  isEmbedded: false,
  setIsEmbedded: (isEmbedded) => set({ isEmbedded }),
}))