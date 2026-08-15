import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { paymentFlowService } from './PaymentFlowService';
import { availabilityService } from './AvailabilityService';
import { timeService } from './TimeService';

/**
 * Batch 1B — PaymentAttempt integrity and 10-minute capacity holds.
 */

let business: any;
let category: any;
let staffA: any;
let staffB: any;

function dateStr(): string {
  return timeService.toDateStr(new Date(Date.now() + 4 * 86400000), 'UTC');
}

async function makeStaffService(price = 500, overrides: any = {}) {
  return prisma.service.create({
    data: {
      businessId: business.id,
      categoryId: category.id,
      name: `StaffSvc-${crypto.randomBytes(3).toString('hex')}`,
      durationMinutes: 30,
      bufferMinutes: 0,
      price,
      resourceMode: 'STAFF_BASED',
      capacity: 1,
      staff: { create: [{ staffId: staffA.id, businessId: business.id }] },
      ...overrides,
    },
    include: { workingHours: true, staff: true },
  });
}

async function makePooledService(price = 400, capacity = 2, overrides: any = {}) {
  return prisma.service.create({
    data: {
      businessId: business.id,
      categoryId: category.id,
      name: `PoolSvc-${crypto.randomBytes(3).toString('hex')}`,
      durationMinutes: 30,
      bufferMinutes: 0,
      price,
      resourceMode: 'POOLED',
      capacity,
      ...overrides,
    },
    include: { workingHours: true, staff: true },
  });
}

function initiateBody(service: any, startTime: string, extra: any = {}) {
  return {
    serviceId: service.id,
    staffId: service.resourceMode === 'STAFF_BASED' ? staffA.id : null,
    date: dateStr(),
    startTime,
    customerName: 'Test User',
    customerPhone: '+911111111111',
    customerEmail: 'test@example.com',
    source: 'QR',
    ...extra,
  };
}

before(async () => {
  const tag = crypto.randomBytes(4).toString('hex');
  business = await prisma.business.create({
    data: {
      name: 'Payment Test',
      slug: `pay-test-${tag}`,
      publicCode: crypto.randomBytes(16).toString('base64url'),
      timezone: 'UTC',
      ownerEmail: `pay-${tag}@test.com`,
      ownerPassword: 'hashed',
      bookingWindowDays: 14,
      enablePayments: true,
      paymentMode: 'full',
      slotGranularityMinutes: 15,
      workingHours: {
        create: [
          { dayOfWeek: 0, openTime: '09:00', closeTime: '18:00', isOpen: true },
          { dayOfWeek: 1, openTime: '09:00', closeTime: '18:00', isOpen: true },
          { dayOfWeek: 2, openTime: '09:00', closeTime: '18:00', isOpen: true },
          { dayOfWeek: 3, openTime: '09:00', closeTime: '18:00', isOpen: true },
          { dayOfWeek: 4, openTime: '09:00', closeTime: '18:00', isOpen: true },
          { dayOfWeek: 5, openTime: '09:00', closeTime: '18:00', isOpen: true },
          { dayOfWeek: 6, openTime: '09:00', closeTime: '18:00', isOpen: true },
        ],
      },
    },
  });
  category = await prisma.serviceCategory.create({ data: { businessId: business.id, name: 'Cat' } });
  staffA = await prisma.staff.create({ data: { businessId: business.id, name: 'Staff A' } });
  staffB = await prisma.staff.create({ data: { businessId: business.id, name: 'Staff B' } });
});

beforeEach(async () => {
  await prisma.paymentAttempt.deleteMany({ where: { businessId: business.id } });
  await prisma.booking.deleteMany({ where: { businessId: business.id } });
});

after(async () => {
  await prisma.paymentAttempt.deleteMany({ where: { businessId: business.id } });
  await prisma.booking.deleteMany({ where: { businessId: business.id } });
  await prisma.staffService.deleteMany({ where: { businessId: business.id } });
  await prisma.service.deleteMany({ where: { businessId: business.id } });
  await prisma.serviceCategory.deleteMany({ where: { businessId: business.id } });
  await prisma.staff.deleteMany({ where: { businessId: business.id } });
  await prisma.business.delete({ where: { id: business.id } });
  await prisma.$disconnect();
});

test('1. Initiate creates one PENDING attempt with a 10-minute hold', async () => {
  const service = await makeStaffService();
  const result = await paymentFlowService.initiate(business.publicCode, initiateBody(service, '10:00') as any);
  assert.ok((result as any).orderId, 'razorpay order id returned');
  assert.strictEqual(result.amount, 50000, 'payable is ₹500 in minor units');

  const attempts = await prisma.paymentAttempt.findMany({ where: { businessId: business.id } });
  assert.strictEqual(attempts.length, 1, 'exactly one attempt row');
  const a = attempts[0];
  assert.strictEqual(a.status, 'PENDING');
  assert.strictEqual(a.razorpayOrderId, (result as any).orderId);
  assert.strictEqual(a.paymentMode, 'full');
  assert.strictEqual(a.payableMinor, 50000);
  assert.strictEqual(a.occupiedEndTime, '10:30');
  const holdMs = a.holdExpiresAt.getTime() - a.createdAt.getTime();
  assert.ok(Math.abs(holdMs - 10 * 60000) < 60000, `hold is ~10 minutes (got ${holdMs / 60000} min)`);
  await prisma.service.delete({ where: { id: service.id } });
});

test('1b. STAFF_BASED payment hold auto-assigns staff when no preference is supplied', async () => {
  const service = await makeStaffService();
  await paymentFlowService.initiate(
    business.publicCode,
    initiateBody(service, '10:30', { staffId: null }) as any
  );

  const attempt = await prisma.paymentAttempt.findFirstOrThrow({
    where: { businessId: business.id, serviceId: service.id },
  });
  assert.strictEqual(attempt.staffId, staffA.id);
  await prisma.service.delete({ where: { id: service.id } });
});

test('2. Active staff hold blocks that staff interval', async () => {
  const service = await makeStaffService();
  await paymentFlowService.initiate(business.publicCode, initiateBody(service, '10:00') as any);

  const forA = await availabilityService.computeAvailability(business, service, dateStr(), undefined, { client: prisma });
  const tenForA = forA.slots.find((s) => s.startTime === '10:00');
  assert.ok(!tenForA || !tenForA.eligibleStaffIds.includes(staffA.id), 'staff A is blocked at 10:00 by the hold');

  // Staff B (no hold) is not affected — assign B and verify the slot stays available
  await prisma.staffService.create({ data: { staffId: staffB.id, serviceId: service.id, businessId: business.id } });
  const forB = await availabilityService.computeAvailability(business, service, dateStr(), staffB.id, { client: prisma });
  assert.ok(forB.slots.some((s) => s.startTime === '10:00'), 'staff B slot remains available');
  await prisma.service.delete({ where: { id: service.id } });
});

test('3. Active pooled hold consumes one pool unit', async () => {
  const service = await makePooledService(400, 2);
  await paymentFlowService.initiate(business.publicCode, initiateBody(service, '11:00') as any);

  const avail = await availabilityService.computeAvailability(business, service, dateStr(), undefined, { client: prisma });
  const slot = avail.slots.find((s) => s.startTime === '11:00');
  assert.ok(slot, '11:00 slot exists');
  assert.strictEqual(slot.availableCapacity, 1, 'one pool unit consumed by the hold (capacity 2 -> 1)');
  await prisma.service.delete({ where: { id: service.id } });
});

test('4. Expired/failed/consumed holds no longer block', async () => {
  const service = await makeStaffService();
  const result = await paymentFlowService.initiate(business.publicCode, initiateBody(service, '12:00') as any);
  const attempt = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: (result as any).attemptId } });

  const blocked = await availabilityService.computeAvailability(business, service, dateStr(), staffA.id, { client: prisma });
  assert.ok(!blocked.slots.some((s) => s.startTime === '12:00'), 'hold blocks while active');

  // Expired
  await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'EXPIRED' } });
  const afterExpired = await availabilityService.computeAvailability(business, service, dateStr(), staffA.id, { client: prisma });
  assert.ok(afterExpired.slots.some((s) => s.startTime === '12:00'), 'expired hold releases capacity');

  // Failed
  const attempt2 = await paymentFlowService.initiate(business.publicCode, initiateBody(service, '13:00') as any);
  await prisma.paymentAttempt.update({ where: { id: attempt2.attemptId }, data: { status: 'FAILED' } });
  const afterFailed = await availabilityService.computeAvailability(business, service, dateStr(), staffA.id, { client: prisma });
  assert.ok(afterFailed.slots.some((s) => s.startTime === '13:00'), 'failed hold releases capacity');

  // Consumed
  const attempt3 = await paymentFlowService.initiate(business.publicCode, initiateBody(service, '14:00') as any);
  await prisma.paymentAttempt.update({ where: { id: attempt3.attemptId }, data: { status: 'CONSUMED' } });
  const afterConsumed = await availabilityService.computeAvailability(business, service, dateStr(), staffA.id, { client: prisma });
  assert.ok(afterConsumed.slots.some((s) => s.startTime === '14:00'), 'consumed hold releases capacity');
  await prisma.service.delete({ where: { id: service.id } });
});

test('5. Client paymentMode/amount cannot reduce payable amount', async () => {
  const service = await makeStaffService(500);
  const result = await paymentFlowService.initiate(
    business.publicCode,
    initiateBody(service, '15:00', { paymentMode: 'deposit', amount: 1, finalPrice: 1 }) as any
  );
  assert.strictEqual(result.payable, 500, 'payable stays at full price despite client request');
  assert.strictEqual(result.amount, 50000, 'order amount in minor units is server-set');
  const attempt = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: (result as any).attemptId } });
  assert.strictEqual(attempt.paymentMode, 'full', 'payment mode is server-decided');
  assert.strictEqual(attempt.finalPrice, 500);
  await prisma.service.delete({ where: { id: service.id } });
});

test('6. Verify rejects missing/expired/mismatched attempts', async () => {
  const service = await makeStaffService();

  // Missing attempt
  await assert.rejects(
    () => paymentFlowService.verify(business.publicCode, { razorpay_order_id: 'order_test_missing', razorpay_payment_id: 'pay_x', razorpay_signature: 's' }),
    /not found/
  );

  // Expired attempt
  const result = await paymentFlowService.initiate(business.publicCode, initiateBody(service, '10:00') as any);
  await prisma.paymentAttempt.update({ where: { id: (result as any).attemptId }, data: { status: 'PENDING', holdExpiresAt: new Date(Date.now() - 1000) } });
  await assert.rejects(
    () => paymentFlowService.verify(business.publicCode, { razorpay_order_id: (result as any).orderId, razorpay_payment_id: 'pay_x', razorpay_signature: 's' }),
    /expired/
  );
  const expired = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: (result as any).attemptId } });
  assert.strictEqual(expired.status, 'EXPIRED');

  // Mismatched signature on a non-test order id
  const attempt = await prisma.paymentAttempt.create({
    data: {
      businessId: business.id,
      serviceId: service.id,
      staffId: staffA.id,
      date: timeService.dateToUtcMidnight(dateStr()),
      startTime: '11:00',
      endTime: '11:30',
      occupiedEndTime: '11:30',
      customerData: { customerName: 'T', customerPhone: '+911111111111' } as any,
      formData: {} as any,
      originalPrice: 500,
      discountAmount: 0,
      finalPrice: 500,
      payableMinor: 50000,
      paymentMode: 'full',
      status: 'PENDING',
      razorpayOrderId: 'order_live_x123',
      holdExpiresAt: new Date(Date.now() + 600000),
    },
  });
  await assert.rejects(
    () => paymentFlowService.verify(business.publicCode, { razorpay_order_id: 'order_live_x123', razorpay_payment_id: 'pay_live_x', razorpay_signature: 'bogus' }),
    /verification failed/
  );
  const failed = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
  assert.strictEqual(failed.status, 'FAILED');
  await prisma.service.delete({ where: { id: service.id } });
});

test('7. Concurrent/repeated verify creates at most one booking and returns idempotently', async () => {
  const service = await makeStaffService();
  const result = await paymentFlowService.initiate(business.publicCode, initiateBody(service, '10:00') as any);

  const verify = () =>
    paymentFlowService.verify(business.publicCode, {
      razorpay_order_id: (result as any).orderId,
      razorpay_payment_id: 'pay_test_x',
      razorpay_signature: 'test_signature',
    });

  // Concurrent verifies
  const [r1, r2] = await Promise.all([verify(), verify()]);
  assert.strictEqual(r1.booking.id, r2.booking.id, 'both verifies return the same booking');
  const bookingCount = await prisma.booking.count({ where: { businessId: business.id } });
  assert.strictEqual(bookingCount, 1, 'at most one booking is created');

  // Repeated verify returns idempotently
  const r3 = await verify();
  assert.strictEqual(r3.booking.id, r1.booking.id);
  assert.strictEqual(r3.idempotent, true);
  const bookingCountAfter = await prisma.booking.count({ where: { businessId: business.id } });
  assert.strictEqual(bookingCountAfter, 1, 'repeated verify does not create another booking');
  await prisma.service.delete({ where: { id: service.id } });
});

test('8. finalPrice=0 bypasses Razorpay and creates a normal booking', async () => {
  const service = await makePooledService(0, 1);
  const result = await paymentFlowService.initiate(business.publicCode, initiateBody(service, '10:00') as any);
  assert.strictEqual(result.free, true);
  assert.ok(result.booking);
  assert.strictEqual(result.booking.status, 'CONFIRMED');
  assert.strictEqual(result.booking.finalPrice, 0);

  const attempts = await prisma.paymentAttempt.count({ where: { businessId: business.id } });
  assert.strictEqual(attempts, 0, 'no PaymentAttempt created for free booking');
  const bookings = await prisma.booking.count({ where: { businessId: business.id } });
  assert.strictEqual(bookings, 1);
  await prisma.service.delete({ where: { id: service.id } });
});

test('9. Availability counts holds correctly for staff and pooled modes (incl. cross-service pools)', async () => {
  const staffSvc = await makeStaffService();
  await paymentFlowService.initiate(business.publicCode, initiateBody(staffSvc, '10:00') as any);
  const staffAvail = await availabilityService.computeAvailability(business, staffSvc, dateStr(), staffA.id, { client: prisma });
  assert.ok(!staffAvail.slots.some((s) => s.startTime === '10:00'), 'staff hold consumes the staff interval');

  const poolA = await makePooledService(400, 2);
  const poolB = await makePooledService(500, 2);
  await paymentFlowService.initiate(business.publicCode, initiateBody(poolA, '11:00') as any);
  const availA = await availabilityService.computeAvailability(business, poolA, dateStr(), undefined, { client: prisma });
  assert.strictEqual(availA.slots.find((s) => s.startTime === '11:00')?.availableCapacity, 1, 'pool A loses one unit');
  const availB = await availabilityService.computeAvailability(business, poolB, dateStr(), undefined, { client: prisma });
  assert.strictEqual(availB.slots.find((s) => s.startTime === '11:00')?.availableCapacity, 2, 'pool B is not affected by pool A hold');
  await prisma.service.deleteMany({ where: { id: { in: [staffSvc.id, poolA.id, poolB.id] } } });
});

test('10. Cron cleanup expires stale holds idempotently', async () => {
  const service = await makeStaffService();
  const result = await paymentFlowService.initiate(business.publicCode, initiateBody(service, '10:00') as any);
  // Simulate time passing by moving holdExpiresAt into the past
  await prisma.paymentAttempt.update({ where: { id: (result as any).attemptId }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });

  const expired = await paymentFlowService.expireStaleHolds(new Date());
  assert.strictEqual(expired, 1);
  const attempt = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: (result as any).attemptId } });
  assert.strictEqual(attempt.status, 'EXPIRED');

  // Idempotent: second run expires nothing
  const again = await paymentFlowService.expireStaleHolds(new Date());
  assert.strictEqual(again, 0);
  await prisma.service.delete({ where: { id: service.id } });
});

test('11. STAFF_BASED initiate auto-assigns missing staffId and persists source', async () => {
  const service = await makeStaffService();
  // Without a preference the backend must choose an available assigned member.
  const bodyNoStaff = initiateBody(service, '10:00');
  delete (bodyNoStaff as any).staffId;
  const automatic = await paymentFlowService.initiate(business.publicCode, bodyNoStaff as any);
  const automaticAttempt = await prisma.paymentAttempt.findUniqueOrThrow({
    where: { id: automatic.attemptId },
  });
  assert.strictEqual(automaticAttempt.staffId, staffA.id);

  // With staffId + source the attempt is created and attribution is persisted
  const result = await paymentFlowService.initiate(
    business.publicCode,
    initiateBody(service, '11:00', { source: 'QR' }) as any
  );
  assert.ok(result.attemptId, 'attempt created for staff-based service');
  const attempt = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: (result as any).attemptId } });
  assert.strictEqual(attempt.staffId, staffA.id, 'staffId is persisted on the attempt');
  assert.strictEqual(attempt.source, 'QR', 'source is persisted on the attempt');
  await prisma.service.delete({ where: { id: service.id } });
});
