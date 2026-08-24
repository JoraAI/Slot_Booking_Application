import crypto from 'crypto';

/** Notes key attached to platform Razorpay orders (wallet / subscription). */
export const RAZORPAY_BUSINESS_NOTE = 'reservly_business_id';
export const RAZORPAY_PURPOSE_NOTE = 'reservly_purpose';

export function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const left = Buffer.from(String(a || ''), 'utf8');
    const right = Buffer.from(String(b || ''), 'utf8');
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

export function verifyRazorpayPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string,
  keySecret: string
): boolean {
  if (!keySecret || !orderId || !paymentId || !signature) return false;
  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return timingSafeEqualHex(expected, signature);
}

export function platformOrderNotes(businessId: string, purpose: 'whatsapp_wallet' | 'subscription') {
  return {
    [RAZORPAY_BUSINESS_NOTE]: businessId,
    [RAZORPAY_PURPOSE_NOTE]: purpose,
  };
}

export function orderBelongsToBusiness(order: any, businessId: string, purpose?: string): boolean {
  const notes = order?.notes || {};
  if (String(notes[RAZORPAY_BUSINESS_NOTE] || '') !== businessId) return false;
  if (purpose && String(notes[RAZORPAY_PURPOSE_NOTE] || '') !== purpose) return false;
  return true;
}
