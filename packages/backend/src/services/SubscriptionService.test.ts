import { test } from 'node:test';
import assert from 'node:assert';
import {
  addMonthsUtc,
  commissionDueAndCycle,
  fixedPlanDueAndCycle,
} from './SubscriptionService';

test('fixed monthly plan: unpaid shows due and no cycle end', () => {
  const now = new Date('2026-09-07T12:00:00Z');
  const v = fixedPlanDueAndCycle({
    plan: 'MONTHLY_799',
    monthlyInr: 799,
    paidUntil: null,
    now,
    isTrial: false,
  });
  assert.strictEqual(v.dueInr, 799);
  assert.strictEqual(v.isActive, false);
  assert.strictEqual(v.currentCycleEndsAt, null);
});

test('fixed monthly plan: after payment due is 0 and cycle ends at paidUntil', () => {
  const now = new Date('2026-09-07T12:00:00Z');
  const paidUntil = addMonthsUtc(now, 1);
  const v = fixedPlanDueAndCycle({
    plan: 'MONTHLY_799',
    monthlyInr: 799,
    paidUntil,
    now,
    isTrial: false,
  });
  assert.strictEqual(v.dueInr, 0);
  assert.strictEqual(v.paidInr, 799);
  assert.strictEqual(v.isActive, true);
  assert.strictEqual(v.currentCycleEndsAt, paidUntil.toISOString());
});

test('fixed yearly plan: due is 12x monthly until paid', () => {
  const now = new Date('2026-09-07T12:00:00Z');
  const unpaid = fixedPlanDueAndCycle({
    plan: 'YEARLY_799',
    monthlyInr: 799,
    paidUntil: null,
    now,
    isTrial: false,
  });
  assert.strictEqual(unpaid.dueInr, 799 * 12);

  const paidUntil = addMonthsUtc(now, 12);
  const paid = fixedPlanDueAndCycle({
    plan: 'YEARLY_799',
    monthlyInr: 799,
    paidUntil,
    now,
    isTrial: false,
  });
  assert.strictEqual(paid.dueInr, 0);
  assert.strictEqual(paid.currentCycleEndsAt, paidUntil.toISOString());
});

test('fixed plan trial: still shows due so early pay is allowed', () => {
  const now = new Date('2026-09-07T12:00:00Z');
  const v = fixedPlanDueAndCycle({
    plan: 'MONTHLY_799',
    monthlyInr: 799,
    paidUntil: null,
    now,
    isTrial: true,
  });
  assert.strictEqual(v.dueInr, 799);
  assert.strictEqual(v.isActive, true);
  assert.strictEqual(v.currentCycleEndsAt, null);
});

test('commission: after full payment remaining due is 0 and period end stays', () => {
  const periodEndsAt = new Date('2026-09-30T23:59:59.999Z');
  const unpaid = commissionDueAndCycle({
    calculatedDueInr: 120,
    monthKey: '2026-09',
    periodEndsAt,
    paidForMonthKey: null,
    paidInr: 0,
    isTrial: false,
  });
  assert.strictEqual(unpaid.dueInr, 120);
  assert.strictEqual(unpaid.isActive, false);

  const paid = commissionDueAndCycle({
    calculatedDueInr: 120,
    monthKey: '2026-09',
    periodEndsAt,
    paidForMonthKey: '2026-09',
    paidInr: 120,
    isTrial: false,
  });
  assert.strictEqual(paid.dueInr, 0);
  assert.strictEqual(paid.isActive, true);
  assert.strictEqual(paid.currentCycleEndsAt, periodEndsAt.toISOString());
});

test('commission: partial payment leaves remaining due', () => {
  const periodEndsAt = new Date('2026-09-30T23:59:59.999Z');
  const v = commissionDueAndCycle({
    calculatedDueInr: 200,
    monthKey: '2026-09',
    periodEndsAt,
    paidForMonthKey: '2026-09',
    paidInr: 80,
    isTrial: false,
  });
  assert.strictEqual(v.dueInr, 120);
  assert.strictEqual(v.isActive, false);
});

test('fixed monthly plan: expired paidUntil shows due again', () => {
  const now = new Date('2026-10-08T12:00:00Z');
  const paidUntil = new Date('2026-10-07T12:00:00Z');
  const v = fixedPlanDueAndCycle({
    plan: 'MONTHLY_799',
    monthlyInr: 799,
    paidUntil,
    now,
    isTrial: false,
  });
  assert.strictEqual(v.dueInr, 799);
  assert.strictEqual(v.isActive, false);
  assert.strictEqual(v.currentCycleEndsAt, null);
});

test('fixed monthly plan: trial prepay then paidThrough wins', () => {
  const now = new Date('2026-09-07T12:00:00Z');
  const paidUntil = addMonthsUtc(now, 1);
  const v = fixedPlanDueAndCycle({
    plan: 'MONTHLY_799',
    monthlyInr: 799,
    paidUntil,
    now,
    isTrial: true,
  });
  assert.strictEqual(v.dueInr, 0);
  assert.strictEqual(v.isActive, true);
  assert.strictEqual(v.currentCycleEndsAt, paidUntil.toISOString());
});

test('addMonthsUtc advances calendar months', () => {
  const d = addMonthsUtc(new Date('2026-09-07T12:00:00Z'), 1);
  assert.strictEqual(d.toISOString().startsWith('2026-10-07'), true);
});
