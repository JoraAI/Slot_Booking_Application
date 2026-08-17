/** Calendar/business-local YYYY-MM-DD from a Date whose Y/M/D are already local. */
export function localDateStr(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Today's calendar date in an IANA timezone, as a local Date at 00:00. */
export function startOfTodayInTimeZone(timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0)
  return new Date(get('year'), get('month') - 1, get('day'))
}

/** Parse a YYYY-MM-DD string as a local calendar date (not UTC midnight). */
export function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}
