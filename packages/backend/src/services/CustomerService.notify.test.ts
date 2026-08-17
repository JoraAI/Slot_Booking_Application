import { test } from 'node:test';
import assert from 'node:assert';
import { isValidNotifyEmail, isValidWhatsappNumber } from './CustomerService';

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
