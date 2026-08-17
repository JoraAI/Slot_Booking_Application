import { test } from 'node:test';
import assert from 'node:assert';
import { timeService } from './TimeService';

test('toTimeStr never emits hour 24 around local midnight', () => {
  // 2026-08-17 18:30 UTC = 2026-08-18 00:00 IST
  const midnight = new Date(Date.UTC(2026, 7, 17, 18, 30, 0));
  const justAfter = new Date(Date.UTC(2026, 7, 17, 19, 7, 0)); // 00:37 IST
  assert.strictEqual(timeService.toTimeStr(midnight, 'Asia/Kolkata'), '00:00');
  assert.strictEqual(timeService.toTimeStr(justAfter, 'Asia/Kolkata'), '00:37');
  assert.strictEqual(timeService.toDateStr(justAfter, 'Asia/Kolkata'), '2026-08-18');
});
