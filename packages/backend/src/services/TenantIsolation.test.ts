import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import express from 'express';
import prisma from '../lib/prisma';
import { bookingService } from './BookingService';
import { bookingManagementService } from './BookingManagementService';
import { paymentFlowService } from './PaymentFlowService';
import { publicRouter } from '../routes/public';
import { ownerRouter } from '../routes/owner';
import { timeService } from './TimeService';

/**
 * Batch 1D — multi-tenant isolation. Owner JWT endpoints exercised at the HTTP
 * route level with the same scoping rules the routes use.
 */

let server: any;
let baseUrl: string;
let tenantA: any;
let tenantB: any;
const createdIds: string[] = [];

function dateStr(days = 4): string {
  return timeService.toDateStr(new Date(Date.now() + days * 86400000), 'UTC');
}

async function makeTenant(label: string) {
  const tag = crypto.randomBytes(4).toString('hex');
  const b = await prisma.business.create({
    data: {
      name: `TI-${label} ${tag}`,
      slug: `ti-${label}-${tag}`,
      publicCode: crypto.randomBytes(16).toString('base64url'),
      timezone: 'UTC',
      ownerEmail: `ti-${label}-${tag}@test.com`,
      ownerPassword: 'hashed',
      bookingWindowDays: 14,
      enableWaitlist: true,
      enableMultiStaff: true,
      enablePayments: true,
      paymentMode: 'full',
      slotGranularityMinutes: 15,
      workingHours: { create: Array.from({ length: 7 }, (_, i) => ({ dayOfWeek: i, openTime: '09:00', closeTime: '18:00', isOpen: true })) },
    },
  });
  createdIds.push(b.id);

  const cat = await prisma.serviceCategory.create({ data: { businessId: b.id, name: 'Cat' } });
  const staff = await prisma.staff.create({ data: { businessId: b.id, name: 'Staff' } });
  const svc = await prisma.service.create({
    data: {
      businessId: b.id, categoryId: cat.id, name: 'Svc', durationMinutes: 30, price: 100,
      resourceMode: 'STAFF_BASED', staff: { create: [{ staffId: staff.id, businessId: b.id }] },
    },
    include: { workingHours: true, staff: true },
  });
  const section = await prisma.pageSection.create({ data: { businessId: b.id, type: 'ABOUT', title: 'About', displayOrder: 0 } });
  const booking = await bookingService.createBooking(b.publicCode, {
    date: dateStr(), startTime: '10:00', serviceId: svc.id, staffId: staff.id,
    customerName: 'Test', customerPhone: '+911111111111',
  });
  const waitlistEntry = await prisma.waitlistEntry.create({
    data: { businessId: b.id, serviceId: svc.id, date: timeService.dateToUtcMidnight(dateStr()), startTime: '11:00', customerName: 'Test', customerPhone: '+911111111111' },
  });
  const token = jwt.sign({ businessId: b.id, email: b.ownerEmail }, process.env.JWT_SECRET || 'fallback-secret', { expiresIn: '1h' } as any);

  return { b, cat, staff, svc, section, booking, waitlistEntry, token };
}

async function ownerReq(method: string, path: string, token: string, body?: any) {
  const res = await fetch(`${baseUrl}/owner${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status };
}

async function publicReq(method: string, path: string, opts: any = {}) {
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

beforeEach(async () => {
  await prisma.business.deleteMany({ where: { id: { in: createdIds } } });
  createdIds.length = 0;
  tenantA = await makeTenant('A');
  tenantB = await makeTenant('B');
});

after(async () => {
  await prisma.business.deleteMany({ where: { id: { in: createdIds } } });
  createdIds.length = 0;
  server.close();
  await prisma.$disconnect();
});

test('1. Business A cannot update/delete Business B categories, and cannot read them via list', async () => {
  const up = await ownerReq('PUT', `/categories/${tenantB.cat.id}`, tenantA.token, { name: 'Hijack' });
  assert.strictEqual(up.status, 404);
  const del = await ownerReq('DELETE', `/categories/${tenantB.cat.id}`, tenantA.token);
  assert.strictEqual(del.status, 404);
  const list = await publicReq('GET', `/owner/categories`, { headers: { Authorization: `Bearer ${tenantA.token}` } });
  assert.ok(!list.json.some((c: any) => c.id === tenantB.cat.id), 'A list never contains B category');
});

test('2. Business A cannot update/delete Business B services', async () => {
  const up = await ownerReq('PUT', `/services/${tenantB.svc.id}`, tenantA.token, { name: 'Hijack' });
  assert.strictEqual(up.status, 404);
  const del = await ownerReq('DELETE', `/services/${tenantB.svc.id}`, tenantA.token);
  assert.strictEqual(del.status, 404);
});

test('3. Business A cannot update/delete Business B page sections', async () => {
  const up = await ownerReq('PUT', `/page-sections/${tenantB.section.id}`, tenantA.token, { title: 'Hijack' });
  assert.strictEqual(up.status, 404);
  const del = await ownerReq('DELETE', `/page-sections/${tenantB.section.id}`, tenantA.token);
  assert.strictEqual(del.status, 404);
});

test('4. Business A cannot update/delete Business B staff', async () => {
  const up = await ownerReq('PUT', `/staff/${tenantB.staff.id}`, tenantA.token, { name: 'Hijack' });
  assert.strictEqual(up.status, 404);
  const del = await ownerReq('DELETE', `/staff/${tenantB.staff.id}`, tenantA.token);
  assert.strictEqual(del.status, 404);
});

test('5. Business A cannot read/update Business B service hours', async () => {
  const read = await ownerReq('GET', `/services/${tenantB.svc.id}/hours`, tenantA.token);
  assert.strictEqual(read.status, 404);
  const write = await ownerReq('PUT', `/services/${tenantB.svc.id}/hours`, tenantA.token, { hours: [] });
  assert.strictEqual(write.status, 404);
});

test('6. Business A cannot read/update Business B staff hours', async () => {
  const read = await ownerReq('GET', `/staff/${tenantB.staff.id}/hours`, tenantA.token);
  assert.strictEqual(read.status, 404);
  const write = await ownerReq('PUT', `/staff/${tenantB.staff.id}/hours`, tenantA.token, { hours: [] });
  assert.strictEqual(write.status, 404);
});

test('7. Business A cannot read/update/delete Business B bookings', async () => {
  const read = await ownerReq('GET', `/bookings/${tenantB.booking.id}`, tenantA.token);
  assert.strictEqual(read.status, 404);
  const update = await ownerReq('PUT', `/bookings/${tenantB.booking.id}`, tenantA.token, { status: 'CANCELLED' });
  assert.strictEqual(update.status, 404);
  const del = await ownerReq('DELETE', `/bookings/${tenantB.booking.id}`, tenantA.token);
  assert.strictEqual(del.status, 404);
});

test('8. Business A cannot notify/delete Business B waitlist entries', async () => {
  const notify = await ownerReq('POST', `/waitlist/${tenantB.waitlistEntry.id}/notify`, tenantA.token);
  assert.strictEqual(notify.status, 404);
  const del = await ownerReq('DELETE', `/waitlist/${tenantB.waitlistEntry.id}`, tenantA.token);
  assert.strictEqual(del.status, 404);
});

test('9. Business B cannot verify Business A payment attempts', async () => {
  const init = await paymentFlowService.initiate(tenantA.b.publicCode, {
    serviceId: tenantA.svc.id, staffId: tenantA.staff.id, date: dateStr(), startTime: '12:00',
    customerName: 'Test', customerPhone: '+911111111111',
  } as any);
  await assert.rejects(
    () => paymentFlowService.verify(tenantB.b.publicCode, {
      razorpay_order_id: (init as any).orderId,
      razorpay_payment_id: 'pay_test_x',
      razorpay_signature: 'test_signature',
    }),
    /not found/
  );
});

test('10. Business A management session cannot manage a booking through Business B identifier', async () => {
  const { sessionToken } = await bookingManagementService.createSession(tenantA.b.id, tenantA.booking);
  const res = await publicReq('GET', `/${tenantB.b.publicCode}/bookings/${tenantA.booking.id}/manage`, {
    headers: { 'X-Booking-Session': sessionToken },
  });
  assert.strictEqual(res.status, 401, 'session is booking- AND business-scoped');
});

test('11. StaffService assignment cannot cross businesses', async () => {
  const res = await ownerReq('POST', '/services', tenantA.token, {
    categoryId: tenantA.cat.id,
    name: 'X-Business Staff',
    durationMinutes: 30,
    price: 100,
    resourceMode: 'STAFF_BASED',
    assignedStaffIds: [tenantB.staff.id],
  });
  assert.strictEqual(res.status, 400);
});

test('12. Public config for A never returns B resources', async () => {
  const res = await publicReq('GET', `/${tenantA.b.publicCode}/config`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.json.services.length > 0);
  assert.ok(res.json.services.every((s: any) => s.businessId === tenantA.b.id), 'all services belong to A');
  assert.ok(res.json.serviceCategories.every((c: any) => c.businessId === tenantA.b.id), 'all categories belong to A');
});

test('13. Management token for A cannot authorize a booking in B', async () => {
  await assert.rejects(
    () => bookingManagementService.authorizeToken(tenantB.b.id, tenantB.booking.id, tenantA.booking.managementToken),
    /Unauthorized/
  );
});
