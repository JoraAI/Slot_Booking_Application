import React from 'react'
import { useStore } from '../store'

interface FeatureGateProps {
  feature: 'waitlist' | 'recurring' | 'payments' | 'multiStaff'
  children: React.ReactNode
}

export const FeatureGate: React.FC<FeatureGateProps> = ({ feature, children }) => {
  const { config } = useStore()
  if (!config) return null

  const key = `enable${feature.charAt(0).toUpperCase() + feature.slice(1)}` as keyof typeof config
  if (!config[key]) return null

  return <>{children}</>
}