import { test } from 'node:test';
import assert from 'node:assert';
import { netCollectedAmount } from './analyticsCollected';

test('cancelled bookings never count as collected, even with a listed price', () => {
  assert.strictEqual(netCollectedAmount({
    status: 'CANCELLED',
    paymentStatus: null,
    paymentAmount: null,
  }), 0);

  assert.strictEqual(netCollectedAmount({
    status: 'CANCELLED',
    paymentStatus: 'paid',
    paymentAmount: 750,
  }), 0);

  assert.strictEqual(netCollectedAmount({
    status: 'CANCELLED',
    paymentStatus: 'refunded',
    paymentAmount: 750,
  }), 0);
});

test('unpaid confirmed bookings do not count listed price as collected', () => {
  assert.strictEqual(netCollectedAmount({
    status: 'CONFIRMED',
    paymentStatus: null,
    paymentAmount: null,
  }), 0);

  assert.strictEqual(netCollectedAmount({
    status: 'CONFIRMED',
    paymentStatus: 'pending',
    paymentAmount: 0,
  }), 0);
});

test('paid bookings count paymentAmount, not after refund states', () => {
  assert.strictEqual(netCollectedAmount({
    status: 'CONFIRMED',
    paymentStatus: 'paid',
    paymentAmount: 750,
  }), 750);

  assert.strictEqual(netCollectedAmount({
    status: 'CONFIRMED',
    paymentStatus: 'partial',
    paymentAmount: 200,
  }), 200);

  assert.strictEqual(netCollectedAmount({
    status: 'COMPLETED',
    paymentStatus: 'refund_pending',
    paymentAmount: 750,
  }), 0);
});
