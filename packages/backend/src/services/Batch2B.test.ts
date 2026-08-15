import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import express from 'express';
import prisma from '../lib/prisma';
import { bookingManagementService } from './BookingManagementService';
import { paymentFlowService } from './PaymentFlowService';
import { paymentService } from './PaymentService';
import { refundService } from './RefundService';
import { publicRouter } from '../routes/public';
import { ownerRouter } from '../routes/owner';
import { timeService } from './TimeService';

/**
 * Batch 2B — §12.9 live Razorpay notes (JSON object) + status conservatism.
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
      name: `Batch2B ${tag}`,
      slug: `batch2b-${tag}`,
      publicCode: crypto.randomBytes(16).toString('base64url'),
      timezone: 'UTC',
      ownerEmail: `batch2b-${tag}@test.com`,
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

async function makePaidBooking(b: any, startTime = '10:00') {
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
  } as any);
  // Unique payment id so the test-mode refund cache never collides across tests.
  const paymentId = `pay_test_${crypto.randomBytes(8).toString('hex')}`;
  const result = await paymentFlowService.verify(b.publicCode, {
    razorpay_order_id: (init as any).orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: 'test_signature',
  });
  return { staff, svc, booking: result.booking, paymentId };
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

test('B1. initiateRefund sends notes as a JSON object and retries byte-identically', async () => {
  // Live-mode business so `initiateRefund` takes the real HTTP path.
  business = await makeBusiness({
    razorpayTestMode: false,
    razorpayKeyId: 'rzp_live_x',
    razorpayKeySecret: 'sk_live_y',
  });

  const captured: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: any, init: any) => {
    captured.push(init?.body || '');
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'rfnd_live_x', entity: 'refund', status: 'processed', notes: {} }),
    } as any;
  }) as any;

  try {
    await paymentService.initiateRefund('pay_live_abc123', 500, business.id, 'key-b1-xyz');
    await paymentService.initiateRefund('pay_live_abc123', 500, business.id, 'key-b1-xyz');

    assert.strictEqual(captured.length, 2, 'two live attempts captured');
    const body = JSON.parse(captured[0]);
    assert.deepStrictEqual(body.notes, { slotbook_idempotency_key: 'key-b1-xyz' }, 'notes is the JSON object form');
    assert.ok(!Array.isArray(body.notes), 'notes is NOT an array of {key,value}');
    assert.strictEqual(body.speed, 'optimum');
    assert.strictEqual(body.amount, 50000);
    assert.strictEqual(captured[0], captured[1], 'retry body is byte-identical');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('B2. unknown/absent Razorpay status stays PROCESSING; reconciliation later moves to PROCESSED', async () => {
  business = await makeBusiness();
  const { booking } = await makePaidBooking(business, '10:00');
  const { sessionToken } = await bookingManagementService.createSession(business.id, booking);

  const originalInitiate = paymentService.initiateRefund;
  const originalFetch = paymentService.fetchPaymentRefunds;
  // A "successful" HTTP-shaped response whose status is absent/unknown.
  paymentService.initiateRefund = async (paymentId: string, amount?: number, businessId?: string, key?: string) => {
    const rzp = await originalInitiate.call(paymentService, paymentId, amount, businessId, key);
    delete rzp.status;
    return rzp;
  };

  try {
    const res = await manageCancel(business, booking, sessionToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.refund.status, 'PROCESSING', 'unknown status is NOT claimed PROCESSED');
    assert.ok(res.json.refund.razorpayRefundId, 'refund id is known even when the status is absent');

    let row = await prisma.paymentRefund.findUniqueOrThrow({ where: { bookingId: booking.id } });
    assert.strictEqual(row.status, 'PROCESSING', 'durable row stays PROCESSING');
    let dbBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    assert.strictEqual(dbBooking.paymentStatus, 'refund_pending', 'booking stays refund_pending');

    // Reconciliation later observes status=processed and resolves it.
    paymentService.fetchPaymentRefunds = async (paymentId: string, businessId?: string) => {
      const result = await originalFetch.call(paymentService, paymentId, businessId);
      result.items = result.items.map((r: any) => ({ ...r, status: 'processed' }));
      return result;
    };
    const reconciled = await refundService.reconcileProcessingRefunds();
    assert.ok(reconciled >= 1, 'reconciliation resolved the refund');

    row = await prisma.paymentRefund.findUniqueOrThrow({ where: { bookingId: booking.id } });
    assert.strictEqual(row.status, 'PROCESSED');
    assert.ok(row.processedAt, 'processedAt recorded only after explicit processed status');
    dbBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    assert.strictEqual(dbBooking.paymentStatus, 'refunded');
  } finally {
    paymentService.initiateRefund = originalInitiate;
    paymentService.fetchPaymentRefunds = originalFetch;
  }
});
