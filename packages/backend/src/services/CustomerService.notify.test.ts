import { test } from 'node:test';
import assert from 'node:assert';
import {
  isValidNotifyEmail,
  isValidWhatsappNumber,
  pickContactKeeper,
  customerIdentityKey,
  normalizeCustomerPhone,
  normalizeCustomerEmail,
} from './CustomerService';

test('isValidNotifyEmail accepts real addresses and rejects blanks', () => {
  assert.strictEqual(isValidNotifyEmail('owner@eclatunisexsalon.in'), true);
  assert.strictEqual(isValidNotifyEmail('  A@B.co  '), true);
  assert.strictEqual(isValidNotifyEmail('not-an-email'), false);
  assert.strictEqual(isValidNotifyEmail(''), false);
  assert.strictEqual(isValidNotifyEmail(null), false);
});

test('isValidWhatsappNumber requires 10-15 digits', () => {
  assert.strictEqual(isValidWhatsappNumber('+919876543210'), true);
  assert.strictEqual(isValidWhatsappNumber('9876543210'), true);
  assert.strictEqual(isValidWhatsappNumber('12345'), false);
  assert.strictEqual(isValidWhatsappNumber(''), false);
  assert.strictEqual(isValidWhatsappNumber(null), false);
});

test('identity prefers phone, then email', () => {
  assert.strictEqual(customerIdentityKey('+91 98765 43210', 'a@x.com'), 'phone:+919876543210');
  assert.strictEqual(customerIdentityKey(null, 'A@X.com'), 'email:a@x.com');
  assert.strictEqual(customerIdentityKey(null, null), null);
  assert.strictEqual(normalizeCustomerPhone('+91-98765-43210'), '+919876543210');
  assert.strictEqual(normalizeCustomerEmail(' A@X.COM '), 'a@x.com');
});

test('pickContactKeeper prefers an explicit id, then latest booking', () => {
  const older = { id: 'a', lastBookedAt: new Date('2026-01-01'), bookingCount: 9, updatedAt: new Date('2026-01-02') };
  const newer = { id: 'b', lastBookedAt: new Date('2026-08-01'), bookingCount: 1, updatedAt: new Date('2026-08-02') };
  assert.strictEqual(pickContactKeeper([older, newer]).id, 'b');
  assert.strictEqual(pickContactKeeper([older, newer], 'a').id, 'a');
});
