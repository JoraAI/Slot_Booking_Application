import { describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import {
  orderBelongsToBusiness,
  platformOrderNotes,
  timingSafeEqualHex,
  verifyRazorpayPaymentSignature,
} from './razorpaySecurity';

describe('razorpaySecurity', () => {
  it('timingSafeEqualHex matches equal hex strings', () => {
    assert.strictEqual(timingSafeEqualHex('abc', 'abc'), true);
    assert.strictEqual(timingSafeEqualHex('abc', 'abd'), false);
    assert.strictEqual(timingSafeEqualHex('ab', 'abc'), false);
  });

  it('verifyRazorpayPaymentSignature accepts valid HMAC', () => {
    const secret = 'test_secret';
    const orderId = 'order_1';
    const paymentId = 'pay_1';
    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    assert.strictEqual(verifyRazorpayPaymentSignature(orderId, paymentId, signature, secret), true);
    assert.strictEqual(verifyRazorpayPaymentSignature(orderId, paymentId, 'deadbeef', secret), false);
  });

  it('orderBelongsToBusiness requires notes business + purpose', () => {
    const notes = platformOrderNotes('biz_a', 'whatsapp_wallet');
    assert.strictEqual(orderBelongsToBusiness({ notes }, 'biz_a', 'whatsapp_wallet'), true);
    assert.strictEqual(orderBelongsToBusiness({ notes }, 'biz_b', 'whatsapp_wallet'), false);
    assert.strictEqual(orderBelongsToBusiness({ notes }, 'biz_a', 'subscription'), false);
    assert.strictEqual(orderBelongsToBusiness({ notes: {} }, 'biz_a', 'whatsapp_wallet'), false);
  });
});
