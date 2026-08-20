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
import { availabilityService } from './AvailabilityService';
import { publicRouter } from '../routes/public';
import { ownerRouter } from '../routes/owner';
import { timeService } from './TimeService';

/**
 * Batch 2 — automatic source refunds on customer cancel + live-credential
 * validation (DEEPSEEK_V4_ENHANCEMENT_PROMPT.md §12.6).
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
      name: `Refund ${tag}`,
      slug: `refund-${tag}`,
      publicCode: crypto.randomBytes(16).toString('base64url'),
      timezone: 'UTC',
      ownerEmail: `refund-${tag}@test.com`,
      ownerPassword: 'hashed',
      bookingWindowDays: 14,
      enablePayments: true,
      paymentMode: 'full',
      // Keep tests fast + network-independent: notifications try SMTP/Meta.
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

async function makeServiceAndStaff(b: any, overrides: any = {}) {
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
      ...overrides,
    },
    include: { staff: true, workingHours: true },
  });
  return { cat, staff, svc };
}

async function makePaidBooking(b: any, startTime = '10:00') {
  const { staff, svc } = await makeServiceAndStaff(b);
  const init = await paymentFlowService.initiate(b.publicCode, {
    serviceId: svc.id,
    staffId: staff.id,
    date: dateStr(),
    startTime,
    customerName: 'Test',
    customerPhone: '+919876543210',
    customerEmail: 'test@example.com',
  } as any);
  const result = await paymentFlowService.verify(b.publicCode, {
    razorpay_order_id: (init as any).orderId,
    razorpay_payment_id: 'pay_test_x',
    razorpay_signature: 'test_signature',
  });
  return { staff, svc, booking: result.booking };
}

async function makeUnpaidBooking(b: any) {
  const { staff, svc } = await makeServiceAndStaff(b);
  const booking = await bookingService.createBooking(b.publicCode, {
    date: dateStr(),
    startTime: '11:00',
    serviceId: svc.id,
    staffId: staff.id,
    customerName: 'Free',
    customerPhone: '+919876543210',
    customerEmail: 'free@example.com',
  });
  return { staff, svc, booking };
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

async function cancelBooking(b: any, booking: any, sessionToken: string) {
  return req('DELETE', `/${b.publicCode}/bookings/${booking.id}/manage`, {
    headers: { 'X-Booking-Session': sessionToken },
  });
}

before(async () => {
  // In-process harness mounting the real routers (no index.ts side effects)
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

// ---------- §12.6 tests ----------

test('1. paid full cancel → refund PROCESSED, booking CANCELLED, slot free again', async () => {
  business = await makeBusiness();
  const { staff, svc, booking } = await makePaidBooking(business, '10:00');
  const { sessionToken } = await bookingManagementService.createSession(business.id, booking);

  const res = await cancelBooking(business, booking, sessionToken);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.booking.status, 'CANCELLED');
  assert.ok(res.json.refund, 'cancel response includes a refund object');
  assert.strictEqual(res.json.refund.status, 'PROCESSED');
  assert.strictEqual(res.json.refund.amount, 500, 'full amount refunded');
  assert.ok(res.json.refund.razorpayRefundId, 'mock refund id stored');
  assert.match(res.json.refund.message, /original payment method/);
  assert.match(res.json.refund.message, /5\u20137 working days/);

  const refund = await prisma.paymentRefund.findUnique({ where: { bookingId: booking.id } });
  assert.ok(refund, 'durable PaymentRefund row created');
  assert.strictEqual(refund!.amountMinor, 50000);
  assert.strictEqual(refund!.status, 'PROCESSED');
  assert.strictEqual(refund!.businessId, business.id);

  const dbBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
  assert.strictEqual(dbBooking.status, 'CANCELLED');
  assert.strictEqual(dbBooking.paymentStatus, 'refunded');

  // Capacity freed: availability no longer sees the (cancelled) booking/hold.
  const avail = await availabilityService.computeAvailability(business, svc, dateStr(), staff.id, { client: prisma });
  assert.ok(avail.slots.some((s) => s.startTime === '10:00'), 'slot is free again after cancel+refund');
});

test('2. paid deposit cancel → refunds deposit amount only', async () => {
  business = await makeBusiness({ paymentMode: 'deposit', depositAmount: 100 });
  const { booking } = await makePaidBooking(business, '10:00');
  assert.strictEqual(booking.paymentAmount, 100, 'deposit is what was collected');
  const { sessionToken } = await bookingManagementService.createSession(business.id, booking);

  const res = await cancelBooking(business, booking, sessionToken);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.refund.status, 'PROCESSED');
  assert.strictEqual(res.json.refund.amount, 100, 'only the deposit is refunded');

  const refund = await prisma.paymentRefund.findUniqueOrThrow({ where: { bookingId: booking.id } });
  assert.strictEqual(refund.amountMinor, 10000, 'deposit in paise');
  assert.strictEqual(refund.razorpayPaymentId, booking.razorpayPaymentId);
});

test('3. unpaid cancel → no PaymentRefund row', async () => {
  business = await makeBusiness();
  const { booking } = await makeUnpaidBooking(business);
  const { sessionToken } = await bookingManagementService.createSession(business.id, booking);

  const res = await cancelBooking(business, booking, sessionToken);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.refund, null, 'no refund object for unpaid bookings');
  assert.strictEqual(res.json.booking.status, 'CANCELLED');

  const refunds = await prisma.paymentRefund.count({ where: { bookingId: booking.id } });
  assert.strictEqual(refunds, 0, 'no refund record for unpaid bookings');
});

test('4. double cancel → one PaymentRefund, no second Razorpay call', async () => {
  business = await makeBusiness();
  const { booking } = await makePaidBooking(business, '10:00');
  const { sessionToken } = await bookingManagementService.createSession(business.id, booking);

  let refundCalls = 0;
  const original = paymentService.initiateRefund;
  paymentService.initiateRefund = async (paymentId: string, amount?: number, businessId?: string) => {
    refundCalls++;
    return original.call(paymentService, paymentId, amount, businessId);
  };

  try {
    const first = await cancelBooking(business, booking, sessionToken);
    assert.strictEqual(first.json.refund.status, 'PROCESSED');
    const second = await cancelBooking(business, booking, sessionToken);
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.json.refund.status, 'PROCESSED');

    const refunds = await prisma.paymentRefund.findMany({ where: { bookingId: booking.id } });
    assert.strictEqual(refunds.length, 1, 'one durable refund row despite double cancel');
    assert.strictEqual(refundCalls, 1, 'Razorpay refund initiated exactly once');
  } finally {
    paymentService.initiateRefund = original;
  }
});

test('5. refund API failure → refund FAILED, booking still CANCELLED, one notification', async () => {
  business = await makeBusiness();
  const { booking } = await makePaidBooking(business, '10:00');
  const { sessionToken } = await bookingManagementService.createSession(business.id, booking);

  const originalInitiate = paymentService.initiateRefund;
  const originalNotify = notificationService.sendBookingCancellation;
  let notifyCalls = 0;
  let notifyRefund: any = null;
  // Definitive Razorpay rejection (not a network timeout) → FAILED.
  paymentService.initiateRefund = async () => { throw new Error('Razorpay timeout'); };
  notificationService.sendBookingCancellation = async (_b: any, _bus: any, refund: any) => { notifyCalls++; notifyRefund = refund; };

  try {
    const res = await cancelBooking(business, booking, sessionToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.booking.status, 'CANCELLED', 'booking stays cancelled even when refund fails');
    assert.strictEqual(res.json.refund.status, 'FAILED');
    assert.match(res.json.refund.message, /needs the salon to complete it/);

    const refund = await prisma.paymentRefund.findUniqueOrThrow({ where: { bookingId: booking.id } });
    assert.strictEqual(refund.status, 'FAILED');
    assert.match(refund.failureReason || '', /Razorpay timeout/);
    assert.strictEqual(refund.amountMinor, 50000);

    const dbBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    assert.strictEqual(dbBooking.status, 'CANCELLED');
    assert.strictEqual(dbBooking.paymentStatus, 'refund_failed');
    assert.strictEqual(notifyCalls, 1, 'exactly one cancellation notification');
    assert.strictEqual(notifyRefund?.status, 'FAILED', 'notification carries the FAILED refund state');
  } finally {
    paymentService.initiateRefund = originalInitiate;
    notificationService.sendBookingCancellation = originalNotify;
  }
});

test('6. cross-tenant: business A session cannot cancel/refund business B booking', async () => {
  const bizA = await makeBusiness();
  const bizB = await makeBusiness();
  const bookingA = await makePaidBooking(bizA, '10:00');
  const bookingB = await makePaidBooking(bizB, '10:00');
  const { sessionToken } = await bookingManagementService.createSession(bizA.id, bookingA.booking);

  const res = await req('DELETE', `/${bizB.publicCode}/bookings/${bookingB.booking.id}/manage`, {
    headers: { 'X-Booking-Session': sessionToken },
  });
  assert.strictEqual(res.status, 401);

  const bB = await prisma.booking.findUniqueOrThrow({ where: { id: bookingB.booking.id } });
  assert.strictEqual(bB.status, 'CONFIRMED', 'business B booking is untouched');
  const refunds = await prisma.paymentRefund.count({ where: { bookingId: bookingB.booking.id } });
  assert.strictEqual(refunds, 0, 'no refund created cross-tenant');
});

test('7. live paid checkout cannot be enabled without Razorpay credentials', async () => {
  business = await makeBusiness();
  const token = jwt.sign(
    { businessId: business.id, email: business.ownerEmail },
    process.env.JWT_SECRET || 'fallback-secret',
    { expiresIn: '1h' } as any
  );

  // Live mode + payments, no secret → refused
  const missingSecret = await req('PUT', '/owner/config', {
    headers: { Authorization: `Bearer ${token}` },
    body: { enablePayments: true, razorpayTestMode: false, paymentMode: 'full', razorpayKeyId: 'rzp_live_x' },
  });
  assert.strictEqual(missingSecret.status, 400);
  assert.match(missingSecret.json.error, /Key Secret/);

  // Live mode + payments with both credentials → allowed
  const withCredentials = await req('PUT', '/owner/config', {
    headers: { Authorization: `Bearer ${token}` },
    body: { enablePayments: true, razorpayTestMode: false, paymentMode: 'full', razorpayKeyId: 'rzp_live_x', razorpayKeySecret: 'sk_live_y' },
  });
  assert.strictEqual(withCredentials.status, 200);

  // Test mode still works without real credentials
  const testMode = await req('PUT', '/owner/config', {
    headers: { Authorization: `Bearer ${token}` },
    body: { enablePayments: true, razorpayTestMode: true, paymentMode: 'full', razorpayKeyId: 'rzp_test_x' },
  });
  assert.strictEqual(testMode.status, 200);
});
