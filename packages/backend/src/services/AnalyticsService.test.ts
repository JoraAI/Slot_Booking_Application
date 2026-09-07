import { test } from 'node:test';
import assert from 'node:assert';
import { invoiceCollectedAmount, netCollectedAmount } from './analyticsCollected';

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

test('walk-in and manual invoices count toward collections', () => {
  assert.strictEqual(invoiceCollectedAmount({ source: 'walk_in', total: 500 }), 500);
  assert.strictEqual(invoiceCollectedAmount({ source: 'manual', total: 120 }), 120);
});

test('booking_paid invoices are skipped (already on booking paymentAmount)', () => {
  assert.strictEqual(invoiceCollectedAmount({
    source: 'booking_paid',
    total: 750,
    booking: { status: 'COMPLETED', paymentStatus: 'paid', paymentAmount: 750 },
  }), 0);
});

test('booking_completed cash invoice counts only when booking is unpaid', () => {
  assert.strictEqual(invoiceCollectedAmount({
    source: 'booking_completed',
    total: 600,
    booking: { status: 'COMPLETED', paymentStatus: null, paymentAmount: null },
  }), 600);

  assert.strictEqual(invoiceCollectedAmount({
    source: 'booking_completed',
    total: 600,
    booking: { status: 'COMPLETED', paymentStatus: 'paid', paymentAmount: 600 },
  }), 0);

  assert.strictEqual(invoiceCollectedAmount({
    source: 'booking_completed',
    total: 600,
    booking: { status: 'CANCELLED', paymentStatus: null, paymentAmount: null },
  }), 0);
});
