import React from 'react'
import type { LocationInfo, PageSection, PageSectionType, Service, WorkingHour } from '../types'

const SECTION_ICONS: Record<PageSectionType, string> = {
  HERO: '✨',
  OFFERS: '🏷️',
  GALLERY: '📷',
  ABOUT: 'ℹ️',
  SERVICES: '💇',
  BUSINESS_HOURS: '🕐',
  WHY_CHOOSE_US: '⭐',
  TESTIMONIALS: '💬',
  CONTACT: '📞',
  CUSTOM_TEXT: '📝',
}

/**
 * Renders the owner-configured PageSections for the standalone public booking
 * page. Embed mode (compact booking-only iframe) intentionally omits this —
 * see App.tsx, which gates it with `useEmbedMode()`.
 */
export const PageSections: React.FC<{
  sections: PageSection[]
  services: Service[]
  workingHours: WorkingHour[]
  location?: LocationInfo | null
}> = ({ sections, services, workingHours, location }) => {
  const visible = sections.filter((s) => s.isVisible).sort((a, b) => a.displayOrder - b.displayOrder)
  if (visible.length === 0) return null

  return (
    <div className="mx-auto max-w-2xl px-4 pb-10 pt-2 space-y-6">
      {visible.map((section) => (
        <PageSectionBlock
          key={section.id}
          section={section}
          services={services}
          workingHours={workingHours}
          location={location}
        />
      ))}
    </div>
  )
}

function PageSectionBlock({ section, services, workingHours, location }: {
  section: PageSection
  services: Service[]
  workingHours: WorkingHour[]
  location?: LocationInfo | null
}) {
  const subtitle = typeof section.configuration?.subtitle === 'string' ? section.configuration.subtitle : null
  const content = section.content || ''

  if (section.type === 'SERVICES') {
    const list = services.filter((s) => s.isActive)
    if (list.length === 0) return null
    return (
      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
        <h2 className="text-lg font-bold mb-1">💇 {section.title || 'Our Services'}</h2>
        {subtitle && <p className="text-sm text-gray-500 mb-4">{subtitle}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {list.map((s) => (
            <div key={s.id} className="flex items-center gap-3 p-3 border border-gray-100 dark:border-gray-800 rounded-lg">
              {s.imageUrl && <img src={s.imageUrl} alt={s.name} className="w-12 h-12 rounded-lg object-cover" />}
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{s.name}</p>
                <p className="text-xs text-gray-500">{s.durationMinutes} min</p>
                <p className="text-sm font-semibold text-primary">₹{s.price}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    )
  }

  if (section.type === 'OFFERS') {
    const offers = services.filter((s) => s.isActive && s.discountActive && s.discountValue != null)
    if (offers.length === 0) return null
    return (
      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
        <h2 className="text-lg font-bold mb-1">🏷️ {section.title || 'Offers'}</h2>
        {subtitle && <p className="text-sm text-gray-500 mb-4">{subtitle}</p>}
        <div className="space-y-2">
          {offers.map((s) => (
            <div key={s.id} className="flex items-center justify-between p-3 border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 rounded-lg text-sm">
              <div>
                <p className="font-medium">{s.name}</p>
                <p className="text-xs text-amber-700 dark:text-amber-400">{s.discountLabel || `${s.discountValue}${s.discountType === 'PERCENTAGE' ? '%' : ' ₹'} off`}</p>
              </div>
              <p className="font-semibold">₹{s.price}</p>
            </div>
          ))}
        </div>
      </section>
    )
  }

  if (section.type === 'BUSINESS_HOURS') {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    return (
      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
        <h2 className="text-lg font-bold mb-3">🕐 {section.title || 'Business Hours'}</h2>
        <div className="space-y-1.5 text-sm">
          {days.map((d, i) => {
            const wh = workingHours.find((w) => w.dayOfWeek === i)
            return (
              <div key={d} className="flex justify-between">
                <span className={wh?.isOpen === false ? 'text-gray-400 line-through' : ''}>{d}</span>
                <span className="text-gray-600 dark:text-gray-300">
                  {wh?.isOpen === false ? 'Closed' : `${wh?.openTime || '09:00'} – ${wh?.closeTime || '18:00'}`}
                </span>
              </div>
            )
          })}
        </div>
      </section>
    )
  }

  if (section.type === 'GALLERY') {
    const urls = content.split(/\n+/).map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u))
    return (
      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
        <h2 className="text-lg font-bold mb-3">📷 {section.title || 'Gallery'}</h2>
        {urls.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {urls.map((u, i) => <img key={i} src={u} alt="" className="w-full h-28 object-cover rounded-lg" />)}
          </div>
        ) : (
          <p className="text-sm text-gray-500 whitespace-pre-line">{content}</p>
        )}
      </section>
    )
  }

  if (section.type === 'CONTACT') {
    const hasLocation = !!(location?.address || location?.directionsUrl)
    return (
      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
        <h2 className="text-lg font-bold mb-1">📞 {section.title || 'Contact'}</h2>
        {subtitle && <p className="text-sm text-gray-500 mb-2">{subtitle}</p>}
        {content && <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line mb-3">{content}</p>}
        {hasLocation && (
          <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 p-3 text-sm space-y-1">
            {location?.address && <p className="text-gray-700 dark:text-gray-300">📍 {location.address}</p>}
            {location?.directionsUrl && (
              <a
                href={location.directionsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex text-primary font-medium hover:underline"
              >
                Get directions on Google Maps ↗
              </a>
            )}
          </div>
        )}
      </section>
    )
  }

  const icon = SECTION_ICONS[section.type] || '📝'
  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
      {section.title && <h2 className="text-lg font-bold mb-1">{icon} {section.title}</h2>}
      {subtitle && <p className="text-sm text-gray-500 mb-2">{subtitle}</p>}
      {content && <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line">{content}</p>}
    </section>
  )
}
