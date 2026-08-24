import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import express from 'express';
import prisma from '../lib/prisma';
import { bookingService } from './BookingService';
import { hashOwnerPassword } from './OwnerPassword';
import { ownerRouter } from '../routes/owner';
import { publicRouter } from '../routes/public';
import { timeService } from './TimeService';

/** Booking detail + analytics export + staff salary tests. */

let server: any;
let baseUrl: string;
const createdBusinessIds: string[] = [];

function dateStr(offsetDays = 4) {
  return timeService.toDateStr(new Date(Date.now() + offsetDays * 86400000), 'UTC');
}

async function makeBusiness() {
  const tag = crypto.randomBytes(4).toString('hex');
  const b = await prisma.business.create({
    data: {
      name: `BAS ${tag}`,
      slug: `bas-${tag}`,
      publicCode: crypto.randomBytes(16).toString('base64url'),
      timezone: 'UTC',
      ownerEmail: `bas-${tag}@test.com`,
      ownerPassword: await hashOwnerPassword('password123'),
      bookingWindowDays: 14,
      slotGranularityMinutes: 15,
      enableMultiStaff: true,
      workingHours: {
        create: Array.from({ length: 7 }, (_, i) => ({
          dayOfWeek: i, openTime: '09:00', closeTime: '18:00', isOpen: true,
        })),
      },
    },
  });
  createdBusinessIds.push(b.id);
  return b;
}

async function makeBooking(b: any) {
  const cat = await prisma.serviceCategory.create({ data: { businessId: b.id, name: 'Cat' } });
  const staff = await prisma.staff.create({ data: { businessId: b.id, name: 'Worker', role: 'Stylist', salary: 25000 } });
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
  const booking = await bookingService.createBooking(b.publicCode, {
    date: dateStr(), startTime: '10:00', serviceId: svc.id, staffId: staff.id,
    customerName: 'Test', customerPhone: '+919876543210', customerEmail: 'cust@example.com',
    formData: { 'Preferred stylist': 'Worker', 'Notes': 'hello' },
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

beforeEach(() => {});

after(async () => {
  await prisma.business.deleteMany({ where: { id: { in: createdBusinessIds } } });
  createdBusinessIds.length = 0;
  server.close();
  await prisma.$disconnect();
});

const salarySchema = { salary: 25000 };

test('BAS-1. Staff salary: create with salary, update it, clear it (owner routes)', async () => {
  const business = await makeBusiness();
  const token = ownerToken(business);

  const created = await req('POST', '/owner/staff', {
    headers: { Authorization: `Bearer ${token}` },
    body: { name: 'Paid Worker', role: 'Stylist', salary: 25000 },
  });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.json.salary, 25000);

  const updated = await req('PUT', `/owner/staff/${created.json.id}`, {
    headers: { Authorization: `Bearer ${token}` },
    body: { salary: 30000 },
  });
  assert.strictEqual(updated.status, 200);
  assert.strictEqual(updated.json.salary, 30000);

  const cleared = await req('PUT', `/owner/staff/${created.json.id}`, {
    headers: { Authorization: `Bearer ${token}` },
    body: { salary: null },
  });
  assert.strictEqual(cleared.status, 200);
  assert.strictEqual(cleared.json.salary, null);
});

test('BAS-2. Public config never exposes staff salary', async () => {
  const business = await makeBusiness();
  await prisma.staff.create({
    data: { businessId: business.id, name: 'Secret Salary', salary: 99999 },
  });

  const res = await fetch(`${baseUrl}/${business.publicCode}/config`);
  const json: any = await res.json();
  assert.ok(Array.isArray(json.staff));
  assert.strictEqual(json.staff.length, 1);
  assert.ok(!('salary' in json.staff[0]), 'salary must not appear in public config');
  assert.ok(json.staff[0].name);
});

test('BAS-3. Booking detail returns service, staff, formData, and pricing fields', async () => {
  const business = await makeBusiness();
  const token = ownerToken(business);
  const { booking } = await makeBooking(business);

  const res = await req('GET', `/owner/bookings/${booking.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.customerName, 'Test');
  assert.strictEqual(res.json.service?.name, 'Svc');
  assert.strictEqual(res.json.staff?.name, 'Worker');
  assert.deepStrictEqual(res.json.formData, { 'Preferred stylist': 'Worker', 'Notes': 'hello' });
  assert.ok(Array.isArray(res.json.formAnswers));
  assert.ok(res.json.formAnswers.some((a: any) => a.label === 'Preferred stylist' && a.value === 'Worker'));
  assert.strictEqual(res.json.finalPrice, 500);
  assert.ok(res.json.source);
});

test('BAS-4. Analytics export returns a CSV attachment for the range with the booking', async () => {
  const business = await makeBusiness();
  const token = ownerToken(business);
  const { booking } = await makeBooking(business);

  const day = dateStr();
  const res = await fetch(`${baseUrl}/owner/analytics/export?dateFrom=${day}&dateTo=${day}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.strictEqual(res.status, 200);
  assert.ok(res.headers.get('content-type')?.includes('text/csv'));
  const csv = await res.text();
  assert.ok(csv.includes('customerName'));
  assert.ok(csv.includes(booking.id));
  assert.ok(csv.includes('Svc'));
  assert.ok(csv.includes('Worker'));
});

test('BAS-5. Analytics export validates the range (from > to → 400)', async () => {
  const business = await makeBusiness();
  const token = ownerToken(business);
  const res = await fetch(`${baseUrl}/owner/analytics/export?dateFrom=2026-01-10&dateTo=2026-01-01`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.strictEqual(res.status, 400);
  const body: any = await res.json();
  assert.ok(/before/.test(body.error));
});
