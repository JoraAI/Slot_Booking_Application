import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import express from 'express';
import prisma from '../lib/prisma';
import { bookingService } from './BookingService';
import { paymentFlowService } from './PaymentFlowService';
import { publicRouter } from '../routes/public';
import { ownerRouter } from '../routes/owner';
import { timeService } from './TimeService';

/**
 * Batch 3 — §10.11 unpaid booking race serialization.
 *
 * Every capacity-consuming slot insert (unpaid/free/recurring booking create and
 * payment-hold creation) shares one advisory lock keyed by
 * businessId + serviceId + date + startTime, with availability re-checked
 * inside the lock before the insert. These tests prove concurrent losers get a
 * clean conflict and capacity is never overbooked.
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
      name: `Race ${tag}`,
      slug: `race-${tag}`,
      publicCode: crypto.randomBytes(16).toString('base64url'),
      timezone: 'UTC',
      ownerEmail: `race-${tag}@test.com`,
      ownerPassword: 'hashed',
      bookingWindowDays: 14,
      enablePayments: false,
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

async function makePooledService(capacity = 1, overrides: any = {}) {
  const cat = await prisma.serviceCategory.create({ data: { businessId: business.id, name: 'Cat' } });
  return prisma.service.create({
    data: {
      businessId: business.id,
      categoryId: cat.id,
      name: `Pool-${crypto.randomBytes(3).toString('hex')}`,
      durationMinutes: 30,
      price: 100,
      resourceMode: 'POOLED',
      capacity,
      ...overrides,
    },
    include: { staff: true, workingHours: true },
  });
}

async function makeStaffService() {
  const cat = await prisma.serviceCategory.create({ data: { businessId: business.id, name: 'Cat' } });
  const staff = await prisma.staff.create({ data: { businessId: business.id, name: 'Staff' } });
  const svc = await prisma.service.create({
    data: {
      businessId: business.id,
      categoryId: cat.id,
      name: `Staff-${crypto.randomBytes(3).toString('hex')}`,
      durationMinutes: 30,
      price: 100,
      resourceMode: 'STAFF_BASED',
      staff: { create: [{ staffId: staff.id, businessId: business.id }] },
    },
    include: { staff: true, workingHours: true },
  });
  return { staff, svc };
}

function createBody(svc: any, startTime: string, staffId: string | null = null) {
  return {
    date: dateStr(),
    startTime,
    serviceId: svc.id,
    staffId,
    customerName: 'Race User',
    customerPhone: '+919876543210',
    customerEmail: 'race@example.com',
    source: 'DIRECT',
  };
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

test('B3-1. concurrent unpaid creates for the same pooled capacity unit → one succeeds, one clean conflict', async () => {
  business = await makeBusiness();
  const svc = await makePooledService(1); // capacity 1

  const results = await Promise.allSettled([
    bookingService.createBooking(business.publicCode, createBody(svc, '10:00') as any),
    bookingService.createBooking(business.publicCode, createBody(svc, '10:00') as any),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.strictEqual(fulfilled.length, 1, 'exactly one concurrent create succeeds');
  assert.strictEqual(rejected.length, 1, 'the other gets a clean conflict');
  assert.match(String((rejected[0] as PromiseRejectedResult).reason?.message || ''), /Slot is no longer available/);

  const count = await prisma.booking.count({ where: { businessId: business.id, serviceId: svc.id } });
  assert.strictEqual(count, 1, 'capacity is not overbooked');
});

test('B3-2. concurrent unpaid creates for the same staff slot → one succeeds, one clean conflict', async () => {
  business = await makeBusiness();
  const { staff, svc } = await makeStaffService();

  const results = await Promise.allSettled([
    bookingService.createBooking(business.publicCode, createBody(svc, '10:00', staff.id) as any),
    bookingService.createBooking(business.publicCode, createBody(svc, '10:00', staff.id) as any),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.strictEqual(fulfilled.length, 1, 'exactly one concurrent staff create succeeds');
  assert.strictEqual(rejected.length, 1, 'the other gets a clean conflict');
  assert.match(String((rejected[0] as PromiseRejectedResult).reason?.message || ''), /Slot is no longer available|no longer available/);

  const count = await prisma.booking.count({ where: { businessId: business.id, serviceId: svc.id } });
  assert.strictEqual(count, 1, 'capacity is not overbooked');
});

test('B3-3. concurrent unpaid creates for different non-overlapping slots both succeed', async () => {
  business = await makeBusiness();
  const svc = await makePooledService(1);

  const results = await Promise.allSettled([
    bookingService.createBooking(business.publicCode, createBody(svc, '10:00') as any),
    bookingService.createBooking(business.publicCode, createBody(svc, '10:30') as any),
  ]);

  assert.ok(results.every((r) => r.status === 'fulfilled'), 'both non-overlapping creates succeed');
  const count = await prisma.booking.count({ where: { businessId: business.id, serviceId: svc.id } });
  assert.strictEqual(count, 2, 'both slots are booked');
});

test('B3-4. concurrent unpaid create vs payment-hold initiate for the same slot → exactly one succeeds', async () => {
  business = await makeBusiness({ enablePayments: true, paymentMode: 'full' });
  const svc = await makePooledService(1); // capacity 1, shared slot lock

  const results = await Promise.allSettled([
    bookingService.createBooking(business.publicCode, createBody(svc, '11:00') as any),
    paymentFlowService.initiate(business.publicCode, {
      serviceId: svc.id,
      date: dateStr(),
      startTime: '11:00',
      customerName: 'Race User',
      customerPhone: '+919876543210',
      customerEmail: 'race@example.com',
      source: 'DIRECT',
    } as any),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.strictEqual(fulfilled.length, 1, 'exactly one of booking/hold succeeds (shared slot lock)');
  assert.strictEqual(rejected.length, 1, 'the loser fails its availability re-check');

  const bookings = await prisma.booking.count({ where: { businessId: business.id, serviceId: svc.id } });
  const holds = await prisma.paymentAttempt.count({ where: { businessId: business.id, serviceId: svc.id, status: { in: ['PENDING', 'INITIATING'] } } });
  assert.strictEqual(bookings + holds, 1, 'capacity unit consumed exactly once across both paths');
});

test('B3-5. HTTP unpaid booking create surfaces the clean conflict (one 201, one 400)', async () => {
  business = await makeBusiness();
  const svc = await makePooledService(1);

  const [r1, r2] = await Promise.all([
    req('POST', `/${business.publicCode}/bookings`, { body: createBody(svc, '14:00') }),
    req('POST', `/${business.publicCode}/bookings`, { body: createBody(svc, '14:00') }),
  ]);

  const statuses = [r1.status, r2.status].sort((a, b) => a - b);
  assert.deepStrictEqual(statuses, [201, 400], 'one success and one clean 400 conflict');
  const loser = r1.status === 400 ? r1 : r2;
  assert.match(String(loser.json?.error || ''), /Slot is no longer available/);

  const count = await prisma.booking.count({ where: { businessId: business.id, serviceId: svc.id } });
  assert.strictEqual(count, 1, 'capacity is not overbooked at the HTTP layer');
});

test('B3-6. overlapping-start creates for the same pooled service → one succeeds, one clean conflict', async () => {
  business = await makeBusiness();
  const svc = await makePooledService(1); // capacity 1, 30-min duration

  // 10:00-10:30 and 10:15-10:45 overlap; different startTime → the old
  // per-startTime lock would have let both pass. The service-day lock must not.
  const results = await Promise.allSettled([
    bookingService.createBooking(business.publicCode, createBody(svc, '10:00') as any),
    bookingService.createBooking(business.publicCode, createBody(svc, '10:15') as any),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.strictEqual(fulfilled.length, 1, 'exactly one overlapping create succeeds');
  assert.strictEqual(rejected.length, 1, 'the other gets a clean conflict');
  assert.match(String((rejected[0] as PromiseRejectedResult).reason?.message || ''), /Slot is no longer available/);

  const count = await prisma.booking.count({ where: { businessId: business.id, serviceId: svc.id } });
  assert.strictEqual(count, 1, 'overlapping capacity is not overbooked');
});

test('B3-7. shared-staff creates across different services at overlapping times → one succeeds', async () => {
  business = await makeBusiness();
  const cat = await prisma.serviceCategory.create({ data: { businessId: business.id, name: 'Cat' } });
  const staff = await prisma.staff.create({ data: { businessId: business.id, name: 'Shared' } });
  const svcX = await prisma.service.create({
    data: {
      businessId: business.id, categoryId: cat.id, name: 'X', durationMinutes: 30, price: 100, resourceMode: 'STAFF_BASED',
      staff: { create: [{ staffId: staff.id, businessId: business.id }] },
    },
    include: { staff: true, workingHours: true },
  });
  const svcY = await prisma.service.create({
    data: {
      businessId: business.id, categoryId: cat.id, name: 'Y', durationMinutes: 30, price: 100, resourceMode: 'STAFF_BASED',
      staff: { create: [{ staffId: staff.id, businessId: business.id }] },
    },
    include: { staff: true, workingHours: true },
  });

  // Same staff member, two services, overlapping intervals (10:00-10:30 and
  // 10:15-10:45). The staff-day lock must serialize across services.
  const results = await Promise.allSettled([
    bookingService.createBooking(business.publicCode, createBody(svcX, '10:00', staff.id) as any),
    bookingService.createBooking(business.publicCode, createBody(svcY, '10:15', staff.id) as any),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.strictEqual(fulfilled.length, 1, 'exactly one shared-staff create succeeds');
  assert.strictEqual(rejected.length, 1, 'the other gets a clean conflict');
  assert.match(String((rejected[0] as PromiseRejectedResult).reason?.message || ''), /no longer available/);

  const count = await prisma.booking.count({ where: { businessId: business.id, staffId: staff.id } });
  assert.strictEqual(count, 1, 'the staff member is not double-booked across services');
});

test('B3-8. same staff, non-overlapping times across services → both succeed', async () => {
  business = await makeBusiness();
  const cat = await prisma.serviceCategory.create({ data: { businessId: business.id, name: 'Cat' } });
  const staff = await prisma.staff.create({ data: { businessId: business.id, name: 'Shared' } });
  const svcX = await prisma.service.create({
    data: {
      businessId: business.id, categoryId: cat.id, name: 'X', durationMinutes: 30, price: 100, resourceMode: 'STAFF_BASED',
      staff: { create: [{ staffId: staff.id, businessId: business.id }] },
    },
    include: { staff: true, workingHours: true },
  });
  const svcY = await prisma.service.create({
    data: {
      businessId: business.id, categoryId: cat.id, name: 'Y', durationMinutes: 30, price: 100, resourceMode: 'STAFF_BASED',
      staff: { create: [{ staffId: staff.id, businessId: business.id }] },
    },
    include: { staff: true, workingHours: true },
  });

  // 10:00-10:30 and 11:00-11:30 do not overlap → both must succeed.
  const results = await Promise.allSettled([
    bookingService.createBooking(business.publicCode, createBody(svcX, '10:00', staff.id) as any),
    bookingService.createBooking(business.publicCode, createBody(svcY, '11:00', staff.id) as any),
  ]);

  assert.ok(results.every((r) => r.status === 'fulfilled'), 'both non-overlapping shared-staff creates succeed');
  const count = await prisma.booking.count({ where: { businessId: business.id, staffId: staff.id } });
  assert.strictEqual(count, 2, 'both appointments are booked');
});
