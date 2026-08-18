import React, { useMemo } from 'react'
import { motion } from 'framer-motion'
import type { PublicConfig } from '../../types'

interface ServiceSelectionProps {
  config: PublicConfig
  selectedCategoryId: string | null
  selectedServiceId: string | null
  onSelectCategory: (id: string) => void
  onSelectService: (id: string) => void
}

export const ServiceSelection: React.FC<ServiceSelectionProps> = ({
  config,
  selectedCategoryId,
  selectedServiceId,
  onSelectCategory,
  onSelectService,
}) => {
  const categories = useMemo(
    () => config.serviceCategories.filter((c) => c.isActive).sort((a, b) => a.displayOrder - b.displayOrder),
    [config.serviceCategories]
  )

  const services = useMemo(
    () =>
      config.services
        .filter((s) => s.isActive && (!selectedCategoryId || s.categoryId === selectedCategoryId))
        .sort((a, b) => a.displayOrder - b.displayOrder),
    [config.services, selectedCategoryId]
  )

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Select a Service</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">Choose what you'd like to book</p>
      </div>

      {categories.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onSelectCategory('')}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
              !selectedCategoryId
                ? 'bg-primary text-white border-primary'
                : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => onSelectCategory(cat.id)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                selectedCategoryId === cat.id
                  ? 'bg-primary text-white border-primary'
                  : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {services.length === 0 && (
          <p className="text-sm text-gray-500">No services available in this category.</p>
        )}
        {services.map((service) => {
          const pricing = service.displayedPricing
          const staffNames = service.assignedStaffIds?.length
            ? service.assignedStaffIds
                .map((id) => config.staff.find((s) => s.id === id)?.name)
                .filter(Boolean)
                .join(', ')
            : null
          const selected = selectedServiceId === service.id

          return (
            <motion.button
              key={service.id}
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={() => onSelectService(service.id)}
              className={`w-full text-left p-3 rounded-xl border-2 transition-colors ${
                selected
                  ? 'border-primary bg-primary-light dark:bg-primary/10'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <div className="flex items-start gap-3">
                {service.imageUrl ? (
                  <img
                    src={service.imageUrl}
                    alt=""
                    className="w-16 h-16 rounded-lg object-cover shrink-0 bg-gray-100"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 text-xl">✦</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">{service.name}</div>
                      {service.description && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{service.description}</p>
                      )}
                      <div className="text-xs text-gray-400 mt-1.5">
                        {service.durationMinutes} min
                        {service.bufferMinutes > 0 ? ` + ${service.bufferMinutes} min buffer` : ''}
                        {staffNames ? ` · ${staffNames}` : ''}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {pricing && pricing.discountAmount > 0 ? (
                        <>
                          <div className="font-semibold text-primary">₹{pricing.finalPrice}</div>
                          <div className="text-xs text-gray-400 line-through">₹{pricing.originalPrice}</div>
                          {pricing.discountLabel && (
                            <div className="text-xs font-medium text-green-600">{pricing.discountLabel}</div>
                          )}
                        </>
                      ) : (
                        <div className="font-semibold">₹{pricing?.finalPrice ?? service.price}</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
