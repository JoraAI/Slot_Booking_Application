import { test } from 'node:test';
import assert from 'node:assert';
import { timeService } from './TimeService';

test('toTimeStr never emits hour 24 around local midnight', () => {
  // 2026-08-17 18:30 UTC = 2026-08-18 00:00 IST
  const midnight = new Date(Date.UTC(2026, 7, 17, 18, 30, 0));
  const justAfter = new Date(Date.UTC(2026, 7, 17, 19, 13, 0)); // 00:43 IST
  assert.strictEqual(timeService.toTimeStr(midnight, 'Asia/Kolkata'), '00:00');
  assert.strictEqual(timeService.toTimeStr(justAfter, 'Asia/Kolkata'), '00:43');
  assert.strictEqual(timeService.toDateStr(justAfter, 'Asia/Kolkata'), '2026-08-18');
});

test('0h notice still offers later office hours just after IST midnight', () => {
  const now = new Date(Date.UTC(2026, 7, 17, 19, 13, 0)); // 18 Aug 00:43 IST
  assert.equal(
    timeService.isAtOrBeforeNotice('Asia/Kolkata', '2026-08-18', '00:30', 0, now),
    true,
    'slot already started'
  );
  assert.equal(
    timeService.isAtOrBeforeNotice('Asia/Kolkata', '2026-08-18', '09:00', 0, now),
    false,
    '09:00 is after 00:43 with 0h notice'
  );
  assert.equal(
    timeService.isAtOrBeforeNotice('Asia/Kolkata', '2026-08-18', '09:00', 10, now),
    true,
    '09:00 is before 00:43+10h'
  );
  assert.equal(
    timeService.isAtOrBeforeNotice('Asia/Kolkata', '2026-08-18', '11:00', 10, now),
    false,
    '11:00 is after 00:43+10h'
  );
});
