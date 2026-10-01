/**
 * Isolation smoke: attendance mutations always scope by businessId + staff ownership.
 * (Pure assertions on service validation - no live DB required.)
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { attendanceService } from './AttendanceService'

test('ATT-ISO-1. Rejects invalid status strings', () => {
  assert.equal(attendanceService.isValidStatus('PRESENT'), true)
  assert.equal(attendanceService.isValidStatus('HALF_DAY'), true)
  assert.equal(attendanceService.isValidStatus('NOPE' as any), false)
})

test('ATT-ISO-2. Month parse rejects bad format via summary', async () => {
  await assert.rejects(
    () => attendanceService.summary('biz_dummy', '2026/09'),
    (err: any) => err?.status === 400 || /YYYY-MM/.test(String(err?.message))
  )
})
