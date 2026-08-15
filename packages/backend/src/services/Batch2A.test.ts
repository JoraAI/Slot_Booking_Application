import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import express from 'express';
import prisma from '../lib/prisma';
import { bookingService } from './BookingService';
import { bookingManagementService } from './BookingManagementService';
import { paymentFlowService } from './PaymentFlowService';
import { paymentService } from './PaymentService';
import { notificationService } from './NotificationService';
import { refundService } from './RefundService';
import { publicRouter } from '../routes/public';
import { ownerRouter } from '../routes/owner';
import { timeService } from './TimeService';

/**
 * Batch 2A — §12.8 verification hotfix acceptance tests.
 */

let business: any;
let server: any;
let baseUrl: string;
const createdBusinessIds: string[] = [];

function dateStr(): string {
  return timeService.toDateStr(new Date(Date.now() + 4 * 86400000), 'UTC');
}

async function makeBusiness(overrides: any = {}) {
  const tag = crypto.randomBytes(4).toString('hex');
  const b = await prisma.business.create({
    data: {
      name: `Batch2A ${tag}`,
      slug: `batch2a-${tag}`,
      publicCode: crypto.randomBytes(16).toString('base64url'),
      timezone: 'UTC',
      ownerEmail: `batch2a-${tag}@test.com`,
      ownerPassword: 'hashed',
      bookingWindowDays: 14,
      enablePayments: true,
      paymentMode: 'full',
      notifyCustomerEmail: false,
      notifyOwnerEmail: false,
      notifyCustomerWhatsapp: false,
      notifyOwnerWhatsapp: false,
      slotGranularityMinutes: 15,
      workingHours: {
        create: Array.from({ length: 7 }, (_, i) => ({
          dayOfWeek: i,
          openTime: '09:00',
          closeTime: '18:00',
          isOpen: true,
        })),
      },
      ...overrides,
    },
  });
  createdBusinessIds.push(b.id);
  return b;
}

async function makePaidBooking(b: any, startTime = '10:00', formData: any = null) {
  const cat = await prisma.serviceCategory.create({ data: { businessId: b.id, name: 'Cat' } });
  const staff = await prisma.staff.create({ data: { businessId: b.id, name: 'Staff' } });
  const svc = await prisma.service.create({
    data: {
      businessId: b.id,
      categoryId: cat.id,
      name: 'Svc',
      durationMinutes: 30,
      price: 500,
      resourceMode: 'STAFF_BASED',
      staff: { create: [{ staffId: staff.id, businessId: b.id }] },
    },
    include: { staff: true, workingHours: true },
  });
  const init = await paymentFlowService.initiate(b.publicCode, {
    serviceId: svc.id,
    staffId: staff.id,
    date: dateStr(),
    startTime,
    customerName: 'Test',
    customerPhone: '+919876543210',
    customerEmail: 'test@example.com',
    formData: formData || { note: 'please call before arriving', loyalty: 'gold', consent: true },
  } as any);
  // Unique payment id so the test-mode refund cache never collides across tests.
  const paymentId = `pay_test_${crypto.randomBytes(8).toString('hex')}`;
  const result = await paymentFlowService.verify(b.publicCode, {
    razorpay_order_id: (init as any).orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: 'test_signature',
  });
  return { staff, svc, booking: result.booking, formData: formData || { note: 'please call before arriving', loyalty: 'gold', consent: true } };
}

async function req(method: string, path: string, opts: any = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

async function manageCancel(b: any, booking: any, sessionToken: string) {
  return req('DELETE', `/${b.publicCode}/bookings/${booking.id}/manage`, {
    headers: { 'X-Booking-Session': sessionToken },
  });
}

function ownerToken(b: any): string {
  return jwt.sign(
    { businessId: b.id, email: b.ownerEmail },
    process.env.JWT_SECRET || 'fallback-secret',
    { expiresIn: '1h' } as any
  );
}

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/owner', ownerRouter);
  app.use('/api', publicRouter);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

beforeEach(() => {
  business = null;
});

after(async () => {
  await prisma.business.deleteMany({ where: { id: { in: createdBusinessIds } } });
  createdBusinessIds.length = 0;
  server.close();
  await prisma.$disconnect();
});

test('A1. two truly concurrent customer cancels → one external create-refund call', async () => {
  business = await makeBusiness();
  const { booking } = await makePaidBooking(business, '10:00');
  const s1 = (await bookingManagementService.createSession(business.id, booking)).sessionToken;
  const s2 = (await bookingManagementService.createSession(business.id, booking)).sessionToken;

  let refundCalls = 0;
  const keys: (string | undefined)[] = [];
  const original = paymentService.initiateRefund;
  paymentService.initiateRefund = async (paymentId: string, amount?: number, businessId?: string, key?: string) => {
    refundCalls++;
    keys.push(key);
    return original.call(paymentService, paymentId, amount, businessId, key);
  };

  try {
    const [r1, r2] = await Promise.all([
      manageCancel(business, booking, s1),
      manageCancel(business, booking, s2),
    ]);
    assert.ok([200, 400].includes(r1.status), `first cancel status ${r1.status}`);
    assert.ok([200, 400].includes(r2.status), `second cancel status ${r2.status}`);

    const refunds = await prisma.paymentRefund.findMany({ where: { bookingId: booking.id } });
    assert.strictEqual(refunds.length, 1, 'one durable refund row despite concurrency');
    assert.strictEqual(refundCalls, 1, 'external create-refund called exactly once');
    assert.ok(refunds[0].idempotencyKey, 'stable idempotency key persisted');
    assert.strictEqual(keys[0], refunds[0].idempotencyKey, 'key passed to Razorpay is the persisted key');

    const dbBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    assert.strictEqual(dbBooking.status, 'CANCELLED');
    assert.strictEqual((await prisma.paymentRefund.findUniqueOrThrow({ where: { bookingId: booking.id } })).status, 'PROCESSED');
  } finally {
    paymentService.initiateRefund = original;
  }
});

test('A2. network timeout then retry uses the same key/body and cannot duplicate', async () => {
  business = await makeBusiness();
  const { booking } = await makePaidBooking(business, '10:00');
  const { sessionToken } = await bookingManagementService.createSession(business.id, booking);

  let callCount = 0;
  const keys: string[] = [];
  const bodies: string[] = [];
  const original = paymentService.initiateRefund;
  paymentService.initiateRefund = async (paymentId: string, amount?: number, businessId?: string, key?: string) => {
    callCount++;
    keys.push(key || '');
    bodies.push(JSON.stringify({ amount: Math.round((amount || 0) * 100), speed: 'optimum', notes: key ? { slotbook_idempotency_key: key } : {} }));
    if (callCount === 1) {
      const err: any = new Error('network timeout');
      err.isNetworkError = true;
      throw err;
    }
    return original.call(paymentService, paymentId, amount, businessId, key);
  };

  try {
    const res = await manageCancel(business, booking, sessionToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.refund.status, 'PROCESSING', 'timeout keeps the durable row PROCESSING');
    const afterTimeout = await prisma.paymentRefund.findUniqueOrThrow({ where: { bookingId: booking.id } });
    assert.strictEqual(afterTimeout.status, 'PROCESSING');
    assert.strictEqual(afterTimeout.razorpayRefundId, null);

    // Retry via the durable reconciliation job. The spy stays installed so the
    // retry key/body is captured too; attempt 2 delegates to the real mock
    // (which dedupes by key).
    const reconciled = await refundService.reconcileProcessingRefunds();
    assert.ok(reconciled >= 1, 'reconciliation made progress');

    const finalRow = await prisma.paymentRefund.findUniqueOrThrow({ where: { bookingId: booking.id } });
    assert.strictEqual(finalRow.status, 'PROCESSED');
    assert.ok(finalRow.razorpayRefundId, 'single refund id assigned');
    assert.strictEqual(keys.length, 2, 'exactly two attempts');
    assert.strictEqual(keys[0], keys[1], 'retry uses the SAME idempotency key');
    assert.strictEqual(bodies[0], bodies[1], 'retry body is byte-identical');
  } finally {
    paymentService.initiateRefund = original;
  }
});


test('A3. Razorpay status=pending stays PROCESSING; reconciliation later moves to PROCESSED', async () => {
  business = await makeBusiness();
  const { booking } = await makePaidBooking(business, '10:00');
  const { sessionToken } = await bookingManagementService.createSession(business.id, booking);

  const originalInitiate = paymentService.initiateRefund;
  const originalFetch = paymentService.fetchPaymentRefunds;
  paymentService.initiateRefund = async (paymentId: string, amount?: number, businessId?: string, key?: string) => {
    const rzp = await originalInitiate.call(paymentService, paymentId, amount, businessId, key);
    return { ...rzp, status: 'pending' };
  };

  try {
    const res = await manageCancel(business, booking, sessionToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.refund.status, 'PROCESSING', 'pending maps to PROCESSING');
    let row = await prisma.paymentRefund.findUniqueOrThrow({ where: { bookingId: booking.id } });
    assert.strictEqual(row.status, 'PROCESSING');
    assert.ok(row.razorpayRefundId, 'refund id is known even when pending');
    let dbBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    assert.strictEqual(dbBooking.paymentStatus, 'refund_pending');

    // Reconciliation: Razorpay later reports processed.
    paymentService.fetchPaymentRefunds = async (paymentId: string, businessId?: string) => {
      const result = await originalFetch.call(paymentService, paymentId, businessId);
      result.items = result.items.map((r: any) => ({ ...r, status: 'processed' }));
      return result;
    };
    const reconciled = await refundService.reconcileProcessingRefunds();
    assert.ok(reconciled >= 1, 'reconciliation resolves the pending refund');

    row = await prisma.paymentRefund.findUniqueOrThrow({ where: { bookingId: booking.id } });
    assert.strictEqual(row.status, 'PROCESSED');
    assert.ok(row.processedAt, 'processedAt recorded');
    dbBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    assert.strictEqual(dbBooking.paymentStatus, 'refunded');
  } finally {
    paymentService.initiateRefund = originalInitiate;
    paymentService.fetchPaymentRefunds = originalFetch;
  }
});

test('A4. owner booking cancellation creates the same durable automatic refund', async () => {
  business = await makeBusiness();
  const { booking } = await makePaidBooking(business, '10:00');
  const token = ownerToken(business);

  const res = await req('DELETE', `/owner/bookings/${booking.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.status, 'CANCELLED');
  assert.strictEqual(res.json.refund.status, 'PROCESSED');

  const refund = await prisma.paymentRefund.findUniqueOrThrow({ where: { bookingId: booking.id } });
  assert.strictEqual(refund.status, 'PROCESSED');
  assert.ok(refund.idempotencyKey);
  assert.strictEqual(refund.amountMinor, 50000);
});

test('A5. owner manual refund cannot duplicate an auto-refund and rejects bad amounts', async () => {
  business = await makeBusiness();
  const { booking } = await makePaidBooking(business, '10:00');
  const token = ownerToken(business);

  // Auto-refund first via owner cancel.
  await req('DELETE', `/owner/bookings/${booking.id}`, { headers: { Authorization: `Bearer ${token}` } });

  let refundCalls = 0;
  const original = paymentService.initiateRefund;
  paymentService.initiateRefund = async (paymentId: string, amount?: number, businessId?: string, key?: string) => {
    refundCalls++;
    return original.call(paymentService, paymentId, amount, businessId, key);
  };

  try {
    // Duplicate manual refund: durable pipeline returns existing PROCESSED, no new call.
    const dup = await req('POST', `/owner/payments/${booking.id}/refund`, {
      headers: { Authorization: `Bearer ${token}` },
      body: {},
    });
    assert.strictEqual(dup.status, 200);
    assert.strictEqual(dup.json.refund.status, 'PROCESSED', 'existing auto-refund returned');
    assert.strictEqual(refundCalls, 0, 'no second external refund after auto-refund');
    const refunds = await prisma.paymentRefund.findMany({ where: { bookingId: booking.id } });
    assert.strictEqual(refunds.length, 1, 'still one refund row');

    // Negative / excess / partial amounts are rejected.
    for (const bad of [{ amount: -100 }, { amount: 1 }, { amount: 999999 }]) {
      const rejected = await req('POST', `/owner/payments/${booking.id}/refund`, {
        headers: { Authorization: `Bearer ${token}` },
        body: bad,
      });
      assert.strictEqual(rejected.status, 400, `amount ${JSON.stringify(bad)} rejected`);
    }
  } finally {
    paymentService.initiateRefund = original;
  }
});

test('A6. legacy public GET/PUT/DELETE cannot expose or mutate a booking by ID alone', async () => {
  business = await makeBusiness();
  const { booking } = await makePaidBooking(business, '10:00');

  const get = await req('GET', `/${business.publicCode}/bookings/${booking.id}`);
  assert.strictEqual(get.status, 410);
  const put = await req('PUT', `/${business.publicCode}/bookings/${booking.id}`, { body: { startTime: '12:00' } });
  assert.strictEqual(put.status, 410);
  const del = await req('DELETE', `/${business.publicCode}/bookings/${booking.id}`);
  assert.strictEqual(del.status, 410);

  const dbBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
  assert.strictEqual(dbBooking.status, 'CONFIRMED', 'booking is untouched');
  assert.strictEqual(dbBooking.startTime, '10:00');
  assert.strictEqual(await prisma.paymentRefund.count({ where: { bookingId: booking.id } }), 0);
});

test('A7. paid booking retains complete dynamic formData', async () => {
  business = await makeBusiness();
  const formData = { note: 'please call before arriving', loyalty: 'gold', consent: true, 'custom-field': 'ABC-123' };
  const { booking } = await makePaidBooking(business, '10:00', formData);

  assert.deepStrictEqual(booking.formData, formData, 'paid booking keeps the full formData');
});

test('A8. notification spies prove one customer + one owner cancellation/refund message', async () => {
  business = await makeBusiness({ notifyCustomerEmail: true, notifyOwnerEmail: true });
  const { booking } = await makePaidBooking(business, '10:00');
  const { sessionToken } = await bookingManagementService.createSession(business.id, booking);

  const originalNotify = notificationService.sendBookingCancellation;
  const originalEmail = (notificationService as any).sendEmail;
  let notifyCalls = 0;
  let customerEmails = 0;
  let ownerEmails = 0;
  notificationService.sendBookingCancellation = async (b: any, bus: any, r: any) => {
    notifyCalls++;
    return originalNotify.call(notificationService, b, bus, r);
  };
  (notificationService as any).sendEmail = async (to: string) => {
    if (String(to).toLowerCase() === business.ownerEmail.toLowerCase()) ownerEmails++;
    else customerEmails++;
  };

  try {
    const res = await manageCancel(business, booking, sessionToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.refund.status, 'PROCESSED');
    assert.strictEqual(notifyCalls, 1, 'exactly one cancellation notification method call');
    assert.strictEqual(customerEmails, 1, 'exactly one customer email');
    assert.strictEqual(ownerEmails, 1, 'exactly one owner email');
  } finally {
    notificationService.sendBookingCancellation = originalNotify;
    (notificationService as any).sendEmail = originalEmail;
  }
});

