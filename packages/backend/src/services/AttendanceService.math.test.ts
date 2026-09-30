/**
 * Pure helpers mirrored from AttendanceService salary / working-day math.
 * Kept local so we can unit-test without spinning up Prisma.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate()
}

function countWorkingDays(
  year: number,
  month1to12: number,
  openWeekdays: number[]
): number {
  const last = daysInMonth(year, month1to12)
  let n = 0
  for (let d = 1; d <= last; d++) {
    const dow = new Date(Date.UTC(year, month1to12 - 1, d)).getUTCDay()
    if (openWeekdays.includes(dow)) n += 1
  }
  return n
}

function estimatedPayable(
  present: number,
  half: number,
  salary: number | null,
  workingDays: number
): number | null {
  if (salary == null || workingDays <= 0) return null
  const earned = present + 0.5 * half
  return Math.round(((earned * salary) / workingDays + Number.EPSILON) * 100) / 100
}

test('ATT-1. Mon–Sat working days in Sep 2026 = 26', () => {
  // Sep 2026: 30 days; Sundays = 6,13,20,27 → 4 Sundays → 26
  assert.equal(countWorkingDays(2026, 9, [1, 2, 3, 4, 5, 6]), 26)
})

test('ATT-2. Salary estimate Present + Half-day prorate', () => {
  // 20 present + 2 half = 21 units; salary 26000; working 26 → 21000
  assert.equal(estimatedPayable(20, 2, 26000, 26), 21000)
})

test('ATT-3. No salary → null estimate', () => {
  assert.equal(estimatedPayable(10, 0, null, 26), null)
})

test('ATT-4. Zero working days → null estimate', () => {
  assert.equal(estimatedPayable(5, 0, 10000, 0), null)
})
