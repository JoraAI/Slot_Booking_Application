import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
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
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false)
  const categoryMenuRef = useRef<HTMLDivElement>(null)

  const categories = useMemo(
    () => config.serviceCategories.filter((c) => c.isActive).sort((a, b) => a.displayOrder - b.displayOrder),
    [config.serviceCategories]
  )

  const activeServices = useMemo(
    () => config.services.filter((s) => s.isActive),
    [config.services]
  )

  const services = useMemo(
    () =>
      activeServices
        .filter((s) => !selectedCategoryId || s.categoryId === selectedCategoryId)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [activeServices, selectedCategoryId]
  )

  const selectedCategoryLabel = useMemo(() => {
    if (!selectedCategoryId) return 'All categories'
    return categories.find((c) => c.id === selectedCategoryId)?.name || 'All categories'
  }, [categories, selectedCategoryId])

  const categoryOptions = useMemo(() => {
    const allCount = activeServices.length
    return [
      { id: '', name: 'All categories', count: allCount },
      ...categories.map((cat) => ({
        id: cat.id,
        name: cat.name,
        count: activeServices.filter((s) => s.categoryId === cat.id).length,
      })),
    ]
  }, [activeServices, categories])

  useEffect(() => {
    if (!categoryMenuOpen) return
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null
      if (target && categoryMenuRef.current && !categoryMenuRef.current.contains(target)) {
        setCategoryMenuOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCategoryMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [categoryMenuOpen])

  const pickCategory = (id: string) => {
    onSelectCategory(id)
    setCategoryMenuOpen(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Select a Service</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">Choose what you'd like to book</p>
      </div>

      {categories.length > 1 && (
        <div ref={categoryMenuRef} className="relative">
          <label htmlFor="service-category" className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">
            Category
          </label>
          <button
            id="service-category"
            type="button"
            aria-haspopup="listbox"
            aria-expanded={categoryMenuOpen}
            onClick={() => setCategoryMenuOpen((open) => !open)}
            className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border bg-white dark:bg-gray-900 text-left transition shadow-sm ${
              categoryMenuOpen
                ? 'border-primary ring-2 ring-primary/20'
                : 'border-gray-200 dark:border-gray-700 hover:border-primary/50'
            }`}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0 text-sm font-semibold">
              ▦
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100 break-words [overflow-wrap:anywhere] leading-snug">
                {selectedCategoryLabel}
              </span>
              <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {services.length} service{services.length === 1 ? '' : 's'} shown
              </span>
            </span>
            <span
              className={`text-gray-400 transition-transform duration-200 shrink-0 ${categoryMenuOpen ? 'rotate-180' : ''}`}
              aria-hidden
            >
              ▾
            </span>
          </button>

          <AnimatePresence>
            {categoryMenuOpen && (
              <motion.ul
                role="listbox"
                aria-label="Service categories"
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.16 }}
                className="absolute z-20 mt-2 w-full max-h-64 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl py-1.5"
              >
                {categoryOptions.map((option) => {
                  const selected =
                    (!selectedCategoryId && option.id === '') || selectedCategoryId === option.id
                  return (
                    <li key={option.id || 'all'} role="option" aria-selected={selected}>
                      <button
                        type="button"
                        onClick={() => pickCategory(option.id)}
                        className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition ${
                          selected
                            ? 'bg-primary/10 text-primary'
                            : 'text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere] text-sm font-medium leading-snug">
                          {option.name}
                        </span>
                        <span
                          className={`shrink-0 text-xs tabular-nums px-2 py-0.5 rounded-full ${
                            selected
                              ? 'bg-primary/15 text-primary'
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-500'
                          }`}
                        >
                          {option.count}
                        </span>
                        {selected && <span className="shrink-0 text-primary text-sm" aria-hidden>✓</span>}
                      </button>
                    </li>
                  )
                })}
              </motion.ul>
            )}
          </AnimatePresence>
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
                      <div className="font-medium break-words [overflow-wrap:anywhere] leading-snug">{service.name}</div>
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
