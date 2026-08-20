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
 * Batch 1C — customer management tokens + optional OTP.
 */

let business: any;
let server: any;
let baseUrl: string;
const createdBusinessIds: string[] = [];

const sha = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

function dateStr(): string {
  return timeService.toDateStr(new Date(Date.now() + 4 * 86400000), 'UTC');
}

async function makeBusiness(otpEnabled = false, otpChannel: string | null = null) {
  const tag = crypto.randomBytes(4).toString('hex');
  const b = await prisma.business.create({
    data: {
      name: `Mgmt ${tag}`,
      slug: `mgmt-${tag}`,
      publicCode: crypto.randomBytes(16).toString('base64url'),
      timezone: 'UTC',
      ownerEmail: `mgmt-${tag}@test.com`,
      ownerPassword: 'hashed',
      bookingWindowDays: 14,
      bookingManagementOtpEnabled: otpEnabled,
      bookingManagementOtpChannel: otpChannel,
      slotGranularityMinutes: 15,
      workingHours: {
        create: Array.from({ length: 7 }, (_, i) => ({
          dayOfWeek: i,
          openTime: '09:00',
          closeTime: '18:00',
          isOpen: true,
        })),
      },
    },
  });
  createdBusinessIds.push(b.id);
  return b;
}

async function makeBooking(b: any) {
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
  const booking = await bookingService.createBooking(b.publicCode, {
    date: dateStr(),
    startTime: '10:00',
    serviceId: svc.id,
    staffId: staff.id,
    customerName: 'Test User',
    customerPhone: '+919876543210',
    customerEmail: 'test@example.com',
  });
  return { cat, staff, svc, booking };
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
  // In-process harness mounting the real routers (no index.ts side effects)
  const app = express();
  app.use(express.json());
  app.use('/api/owner', ownerRouter);
  app.use('/api', publicRouter);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

beforeEach(async () => {
  // Clean only businesses created by this test file (cascades to their
  // bookings/attempts/sessions/OTPs). Never touches seeded/demo data.
  await prisma.business.deleteMany({ where: { id: { in: createdBusinessIds } } });
  createdBusinessIds.length = 0;
});

after(async () => {
  await prisma.business.deleteMany({ where: { id: { in: createdBusinessIds } } });
  createdBusinessIds.length = 0;
  server.close();
  await prisma.$disconnect();
});

test('1. new booking returns managementToken once and stores only the hash', async () => {
  business = await makeBusiness();
  const { booking } = await makeBooking(business);
  assert.ok(booking.managementToken, 'plaintext token returned at creation');
  assert.ok(booking.managementUrl, 'management URL returned at creation');
  assert.ok(booking.managementToken.length >= 32, 'token has >= 128 bits entropy');
  assert.ok(booking.managementUrl.includes(business.publicCode), 'management URL uses opaque publicCode');

  const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
  assert.ok(row.managementTokenHash, 'hash is stored');
  assert.notStrictEqual(row.managementTokenHash, booking.managementToken, 'plaintext is not stored');
  assert.strictEqual(row.managementTokenHash, sha(booking.managementToken), 'stored value is the SHA-256 hash');
});

test('2. booking ID alone cannot view/manage', async () => {
  business = await makeBusiness();
  const { booking } = await makeBooking(business);

  // GET /manage with no session header
  const noSession = await req('GET', `/${business.publicCode}/bookings/${booking.id}/manage`);
  assert.strictEqual(noSession.status, 401);

  // manage/session with no/invalid token
  const noToken = await req('POST', `/${business.publicCode}/bookings/${booking.id}/manage/session`, { body: {} });
  assert.strictEqual(noToken.status, 400);
  const badToken = await req('POST', `/${business.publicCode}/bookings/${booking.id}/manage/session`, { body: { token: 'x'.repeat(32) } });
  assert.strictEqual(badToken.status, 401);
});

test('3. correct token authorizes the correct booking only', async () => {
  business = await makeBusiness();
  const { booking } = await makeBooking(business);

  const ok = await bookingManagementService.authorizeToken(business.id, booking.id, booking.managementToken);
  assert.strictEqual(ok.id, booking.id);

  await assert.rejects(
    () => bookingManagementService.authorizeToken(business.id, booking.id, 'y'.repeat(32)),
    /Unauthorized/
  );
});

test('4. token for booking A cannot manage booking B or another tenant', async () => {
  business = await makeBusiness();
  const { booking: bookingA } = await makeBooking(business);
  const { booking: bookingB } = await makeBooking(business);

  // A's token against B's id
  await assert.rejects(
    () => bookingManagementService.authorizeToken(business.id, bookingB.id, bookingA.managementToken),
    /Unauthorized/
  );

  // Cross-tenant: A's token against a booking in another business
  const other = await makeBusiness();
  const { booking: otherBooking } = await makeBooking(other);
  await assert.rejects(
    () => bookingManagementService.authorizeToken(other.id, otherBooking.id, bookingA.managementToken),
    /Unauthorized/
  );
});

test('5. OTP off: token-only management works', async () => {
  business = await makeBusiness(false);
  const { booking } = await makeBooking(business);

  const session = await req('POST', `/${business.publicCode}/bookings/${booking.id}/manage/session`, {
    body: { token: booking.managementToken },
  });
  assert.strictEqual(session.status, 200);
  assert.strictEqual(session.json.otpRequired, false);
  assert.ok(session.json.sessionToken);
  assert.strictEqual(session.json.booking.id, booking.id);

  // View with the session
  const view = await req('GET', `/${business.publicCode}/bookings/${booking.id}/manage`, {
    headers: { 'X-Booking-Session': session.json.sessionToken },
  });
  assert.strictEqual(view.status, 200);
  assert.strictEqual(view.json.booking.id, booking.id);
});

test('6. OTP on: token alone is not enough; OTP must be verified', async () => {
  business = await makeBusiness(true, 'EMAIL');
  const { booking } = await makeBooking(business);

  // manage/session requires OTP
  const session = await req('POST', `/${business.publicCode}/bookings/${booking.id}/manage/session`, {
    body: { token: booking.managementToken },
  });
  assert.strictEqual(session.status, 200);
  assert.strictEqual(session.json.otpRequired, true);
  assert.ok(!session.json.sessionToken, 'no session without OTP');

  // The management token is NOT a session: it cannot be used to view
  const tokenAsSession = await req('GET', `/${business.publicCode}/bookings/${booking.id}/manage`, {
    headers: { 'X-Booking-Session': booking.managementToken },
  });
  assert.strictEqual(tokenAsSession.status, 401);

  // otp/request fails safely when SMTP is not configured
  const otpReq = await req('POST', `/${business.publicCode}/bookings/${booking.id}/manage/otp/request`, {
    body: { token: booking.managementToken },
  });
  assert.notStrictEqual(otpReq.status, 200, 'must not issue OTP without a provider');

  // Simulate a delivered OTP row, then verify
  const code = '123456';
  await prisma.bookingManagementOtp.create({
    data: {
      businessId: business.id,
      bookingId: booking.id,
      channel: 'EMAIL',
      destinationHash: sha('test@example.com'),
      codeHash: sha(code),
      expiresAt: new Date(Date.now() + 10 * 60000),
    },
  });
  const verify = await req('POST', `/${business.publicCode}/bookings/${booking.id}/manage/otp/verify`, {
    body: { token: booking.managementToken, code },
  });
  assert.strictEqual(verify.status, 200);
  assert.ok(verify.json.sessionToken);

  const view = await req('GET', `/${business.publicCode}/bookings/${booking.id}/manage`, {
    headers: { 'X-Booking-Session': verify.json.sessionToken },
  });
  assert.strictEqual(view.status, 200);
});

test('7. OTP expiry, single-use, attempt limits, resend limits, masking', async () => {
  business = await makeBusiness();
  const { booking } = await makeBooking(business);

  // Destination masking
  assert.strictEqual(bookingManagementService.maskDestination('EMAIL', 'test@example.com'), 't***@example.com');
  const maskedPhone = bookingManagementService.maskDestination('SMS', '+919876543210');
  assert.ok(maskedPhone.includes('***'));
  assert.ok(maskedPhone.endsWith('3210'));
  assert.ok(!maskedPhone.includes('9876'));

  // Expiry
  await prisma.bookingManagementOtp.deleteMany({ where: { bookingId: booking.id } });
  await prisma.bookingManagementOtp.create({
    data: { businessId: business.id, bookingId: booking.id, channel: 'EMAIL', destinationHash: sha('x@y.z'), codeHash: sha('111111'), expiresAt: new Date(Date.now() - 1000) },
  });
  await assert.rejects(
    () => bookingManagementService.verifyOtp(business, booking, '111111', null),
    /expired/
  );

  // Single-use + attempt limits
  const code = '222222';
  await prisma.bookingManagementOtp.deleteMany({ where: { bookingId: booking.id } });
  await prisma.bookingManagementOtp.create({
    data: { businessId: business.id, bookingId: booking.id, channel: 'EMAIL', destinationHash: sha('x@y.z'), codeHash: sha(code), expiresAt: new Date(Date.now() + 600000), maxAttempts: 5 },
  });
  for (let i = 0; i < 5; i++) {
    await assert.rejects(() => bookingManagementService.verifyOtp(business, booking, '000000', null), /Incorrect verification code/);
  }
  await assert.rejects(() => bookingManagementService.verifyOtp(business, booking, code, null), /Too many incorrect attempts/);

  // Single-use: fresh OTP, verify once, second verify rejected
  const code2 = '333333';
  await prisma.bookingManagementOtp.deleteMany({ where: { bookingId: booking.id } });
  await prisma.bookingManagementOtp.create({
    data: { businessId: business.id, bookingId: booking.id, channel: 'EMAIL', destinationHash: sha('x@y.z'), codeHash: sha(code2), expiresAt: new Date(Date.now() + 600000) },
  });
  const first = await bookingManagementService.verifyOtp(business, booking, code2, null);
  assert.ok(first.sessionToken);
  await assert.rejects(() => bookingManagementService.verifyOtp(business, booking, code2, null), /No active OTP/);

  // Resend limit: 3 active challenges blocks further requests before sending
  const b2 = await makeBooking(business);
  for (let i = 0; i < 3; i++) {
    await prisma.bookingManagementOtp.create({
      data: { businessId: business.id, bookingId: b2.booking.id, channel: 'EMAIL', destinationHash: sha('x@y.z'), codeHash: sha('444444'), expiresAt: new Date(Date.now() + 600000) },
    });
  }
  await assert.rejects(
    () => bookingManagementService.requestOtp(business, b2.booking, null),
    /Too many OTP requests/
  );
});

test('8. owner cannot enable email OTP without SMTP config', async () => {
  business = await makeBusiness();
  const token = jwt.sign(
    { businessId: business.id, email: business.ownerEmail },
    process.env.JWT_SECRET || 'fallback-secret',
    { expiresIn: '1h' } as any
  );

  const email = await req('PUT', '/owner/config', {
    headers: { Authorization: `Bearer ${token}` },
    body: { bookingManagementOtpEnabled: true, bookingManagementOtpChannel: 'EMAIL' },
  });
  assert.strictEqual(email.status, 400);
  assert.ok(/SMTP/.test(email.json.error));
});

test('9. paid and free booking paths both create management tokens', async () => {
  business = await makeBusiness();
  business = await prisma.business.update({ where: { id: business.id }, data: { enablePayments: true, paymentMode: 'full' } });
  const cat = await prisma.serviceCategory.create({ data: { businessId: business.id, name: 'Cat' } });
  const staff = await prisma.staff.create({ data: { businessId: business.id, name: 'Staff' } });

  // Paid path
  const paidSvc = await prisma.service.create({
    data: {
      businessId: business.id, categoryId: cat.id, name: 'Paid', durationMinutes: 30, price: 500, resourceMode: 'STAFF_BASED',
      staff: { create: [{ staffId: staff.id, businessId: business.id }] },
    },
    include: { workingHours: true, staff: true },
  });
  const init = await paymentFlowService.initiate(business.publicCode, {
    serviceId: paidSvc.id, staffId: staff.id, date: dateStr(), startTime: '10:00',
    customerName: 'Test', customerPhone: '+919876543210', customerEmail: 'test@example.com',
  } as any);
  const paid = await paymentFlowService.verify(business.publicCode, {
    razorpay_order_id: (init as any).orderId,
    razorpay_payment_id: 'pay_test_x',
    razorpay_signature: 'test_signature',
  });
  assert.ok(paid.booking.managementToken, 'paid booking has a management token');

  // Free path
  const freeSvc = await prisma.service.create({
    data: {
      businessId: business.id, categoryId: cat.id, name: 'Free', durationMinutes: 30, price: 0, resourceMode: 'POOLED', capacity: 1,
    },
    include: { workingHours: true, staff: true },
  });
  const free = await paymentFlowService.initiate(business.publicCode, {
    serviceId: freeSvc.id, date: dateStr(), startTime: '11:00',
    customerName: 'Test', customerPhone: '+919876543210', customerEmail: 'test@example.com',
  } as any);
  assert.ok((free as any).free === true);
  assert.ok(free.booking.managementToken, 'free booking has a management token');
});

test('10. customer management rejects rescheduling and leaves the booking unchanged', async () => {
  business = await makeBusiness();
  const { booking } = await makeBooking(business);
  const { sessionToken } = await bookingManagementService.createSession(business.id, booking);

  const response = await req('PUT', `/${business.publicCode}/bookings/${booking.id}/manage`, {
    headers: { 'X-Booking-Session': sessionToken },
    body: { date: dateStr(), startTime: '12:00' },
  });
  assert.strictEqual(response.status, 405);
  assert.match(response.json.error, /rescheduling is not available/i);

  const unchanged = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
  assert.strictEqual(unchanged.startTime, booking.startTime);
});
