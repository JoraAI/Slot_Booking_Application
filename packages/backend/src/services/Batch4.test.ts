import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import express from 'express';
import prisma from '../lib/prisma';
import { bookingService } from './BookingService';
import { paymentFlowService } from './PaymentFlowService';
import { notificationService } from './NotificationService';
import { directionsUrl, locationInfo, validateLocation } from './LocationService';
import { publicRouter } from '../routes/public';
import { ownerRouter } from '../routes/owner';
import { timeService } from './TimeService';

/**
 * Batch 4 — §18.1 salon location + confirmation notifications acceptance tests.
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
      name: `Batch4 ${tag}`,
      slug: `batch4-${tag}`,
      publicCode: crypto.randomBytes(16).toString('base64url'),
      timezone: 'UTC',
      ownerEmail: `batch4-${tag}@test.com`,
      ownerPassword: 'hashed',
      bookingWindowDays: 14,
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

async function makeBooking(b: any, withPayment: boolean) {
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
  if (!withPayment) {
    const booking = await bookingService.createBooking(b.publicCode, {
      date: dateStr(), startTime: '10:00', serviceId: svc.id, staffId: staff.id,
      customerName: 'Test', customerPhone: '+919876543210', customerEmail: 'cust@example.com',
      formData: {},
    });
    return { staff, svc, booking };
  }
  const init = await paymentFlowService.initiate(b.publicCode, {
    serviceId: svc.id, staffId: staff.id, date: dateStr(), startTime: '10:00',
    customerName: 'Test', customerPhone: '+919876543210', customerEmail: 'cust@example.com',
  } as any);
  const result = await paymentFlowService.verify(b.publicCode, {
    razorpay_order_id: (init as any).orderId,
    razorpay_payment_id: `pay_test_${crypto.randomBytes(8).toString('hex')}`,
    razorpay_signature: 'test_signature',
  });
  return { staff, svc, booking: result.booking };
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

test('B4-1. PUT /owner/config validates address + lat/lng pair and bounds', async () => {
  business = await makeBusiness();
  const token = ownerToken(business);

  const ok = await req('PUT', '/owner/config', {
    headers: { Authorization: `Bearer ${token}` },
    body: { address: '  12 MG Road, Bengaluru  ' as any, latitude: 12.9716, longitude: 77.5946 },
  });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.json.address, '12 MG Road, Bengaluru', 'address trimmed');
  assert.strictEqual(ok.json.latitude, 12.9716);

  // lat without lng -> rejected
  const lonely = await req('PUT', '/owner/config', {
    headers: { Authorization: `Bearer ${token}` },
    body: { latitude: 12.97 },
  });
  assert.strictEqual(lonely.status, 400);
  assert.match(lonely.json.error, /set together/i);

  // bounds
  const badLat = await req('PUT', '/owner/config', {
    headers: { Authorization: `Bearer ${token}` },
    body: { latitude: 91, longitude: 0 },
  });
  assert.strictEqual(badLat.status, 400);
  const badLng = await req('PUT', '/owner/config', {
    headers: { Authorization: `Bearer ${token}` },
    body: { latitude: 0, longitude: 181 },
  });
  assert.strictEqual(badLng.status, 400);

  // address too long
  const long = await req('PUT', '/owner/config', {
    headers: { Authorization: `Bearer ${token}` },
    body: { address: 'x'.repeat(501) },
  });
  assert.strictEqual(long.status, 400);
  assert.match(long.json.error, /500 characters/);
});

test('B4-2. directions URL helper prefers coords, falls back to address, null when empty', () => {
  assert.strictEqual(
    directionsUrl('Some Street', 12.9716, 77.5946),
    'https://www.google.com/maps/dir/?api=1&destination=12.9716,77.5946'
  );
  assert.strictEqual(
    directionsUrl('A & B Street', null, null),
    'https://www.google.com/maps/dir/?api=1&destination=A%20%26%20B%20Street'
  );
  assert.strictEqual(directionsUrl('', null, null), null);
  assert.strictEqual(directionsUrl(null, null, null), null);
  assert.strictEqual(directionsUrl(null, 12, null), null, 'lng missing -> no directions');
  assert.strictEqual(directionsUrl('  ', 12, null), null);

  const info = locationInfo({ address: '12 MG Road', latitude: 12.9716, longitude: 77.5946 });
  assert.strictEqual(info.directionsUrl, 'https://www.google.com/maps/dir/?api=1&destination=12.9716,77.5946');
  assert.strictEqual(validateLocation({ latitude: 12, longitude: 78 }), null);
  assert.ok(validateLocation({ latitude: 12 }) !== null);
});

test('B4-3. public config exposes location but never secrets', async () => {
  business = await makeBusiness({ address: '12 MG Road', latitude: 12.9716, longitude: 77.5946 });
  const res = await req('GET', `/${business.publicCode}/config`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.business.location.address, '12 MG Road');
  assert.strictEqual(res.json.business.location.latitude, 12.9716);
  assert.match(res.json.business.location.directionsUrl, /google\.com\/maps\/dir/);
  assert.ok(!('ownerPassword' in res.json.business));
  assert.ok(!JSON.stringify(res.json).includes('razorpayKeySecret'), 'no razorpay secret serialized');
  assert.ok(!JSON.stringify(res.json).includes('ownerPassword'), 'no owner password serialized');
  assert.ok(!JSON.stringify(res.json).includes('smtpPassEnc'));
  assert.ok(!JSON.stringify(res.json).includes('metaWhatsappAccessTokenEnc'));
});

test('B4-4. unpaid + paid confirmation notifications include location, directions, manageUrl, replyTo', async () => {
  for (const paid of [false, true]) {
    business = await makeBusiness({ address: '12 MG Road', latitude: 12.9716, longitude: 77.5946 });
    const { booking } = await makeBooking(business, paid);
    assert.ok(booking.managementUrl, 'booking carries the one-time manage URL');

    const emails: any[] = [];
    const whatsapps: any[] = [];
    const originalEmail = (notificationService as any).sendEmail;
    const originalWhatsApp = (notificationService as any).sendWhatsApp;
    (notificationService as any).sendEmail = async (...args: any[]) => { emails.push(args); };
    (notificationService as any).sendWhatsApp = async (...args: any[]) => { whatsapps.push(args); };

    const notifyBusiness = { ...booking.business, notifyCustomerEmail: true, notifyCustomerWhatsapp: true, ownerWhatsapp: '+919999999999' };
    try {
      await notificationService.sendBookingConfirmation(booking, notifyBusiness);
    } finally {
      (notificationService as any).sendEmail = originalEmail;
      (notificationService as any).sendWhatsApp = originalWhatsApp;
    }

    const customerEmail = emails.find((e) => e[0] === 'cust@example.com');
    assert.ok(customerEmail, `customer email sent (paid=${paid})`);
    assert.strictEqual(customerEmail[3].replyTo, notifyBusiness.ownerEmail, 'email replyTo is the salon ownerEmail');
    assert.match(customerEmail[2], /12 MG Road/);
    assert.match(customerEmail[2], /maps\/dir\/\?api=1/);
    assert.match(customerEmail[2], /View or cancel booking/);
    assert.ok(customerEmail[2].includes(booking.managementUrl), 'managementUrl present in email');

    const customerWhatsApp = whatsapps.find((w) => w[0] === '+919876543210');
    assert.ok(customerWhatsApp, `customer whatsapp sent (paid=${paid})`);
    assert.match(customerWhatsApp[1], /maps\/dir\/\?api=1/);
    assert.ok(customerWhatsApp[1].includes(booking.managementUrl), 'managementUrl present in whatsapp');
    assert.match(customerWhatsApp[1], /wa\.me\/919999999999/, 'owner WhatsApp contact via wa.me, never as Meta From');
  }
});

test('B4-5. reminders include location/directions but never invent a manage token', async () => {
  business = await makeBusiness({ address: '12 MG Road', latitude: 12.9716, longitude: 77.5946 });
  const { booking } = await makeBooking(business, false);
  const reminderBooking = { ...booking, dateDisplay: 'Sun, 20 Aug 2026' };
  delete reminderBooking.managementUrl; // reminders have no token by design

  const emails: any[] = [];
  const whatsapps: any[] = [];
  const originalEmail = (notificationService as any).sendEmail;
  const originalWhatsApp = (notificationService as any).sendWhatsApp;
  (notificationService as any).sendEmail = async (...args: any[]) => { emails.push(args); };
  (notificationService as any).sendWhatsApp = async (...args: any[]) => { whatsapps.push(args); };

  try {
    await notificationService.sendReminder(reminderBooking, booking.business, 'email');
    await notificationService.sendReminder(reminderBooking, booking.business, 'whatsapp');
  } finally {
    (notificationService as any).sendEmail = originalEmail;
    (notificationService as any).sendWhatsApp = originalWhatsApp;
  }

  const emailHtml = emails[0]?.[2] || '';
  const whatsappBody = whatsapps[0]?.[1] || '';
  assert.match(emailHtml, /12 MG Road/);
  assert.match(emailHtml, /maps\/dir\/\?api=1/);
  assert.match(whatsappBody, /maps\/dir\/\?api=1/);
  assert.ok(!emailHtml.includes('/manage?'), 'email reminder does not recreate a manage token');
  assert.ok(!whatsappBody.includes('/manage?'), 'whatsapp reminder does not recreate a manage token');
});

test('B4-6. enabling customer email/WhatsApp without platform prerequisites is rejected', async () => {
  business = await makeBusiness();
  const token = ownerToken(business);

  // SMTP is unconfigured in the test env -> enabling customer email rejected.
  const email = await req('PUT', '/owner/config', {
    headers: { Authorization: `Bearer ${token}` },
    body: { notifyCustomerEmail: true },
  });
  assert.strictEqual(email.status, 400);
  assert.match(email.json.error, /SMTP/);

  // Platform WhatsApp unconfigured / salon not opted in -> rejected.
  const wa = await req('PUT', '/owner/config', {
    headers: { Authorization: `Bearer ${token}` },
    body: { notifyCustomerWhatsapp: true, ownerWhatsapp: '+919999999999' },
  });
  assert.strictEqual(wa.status, 400);
  assert.match(wa.json.error, /WhatsApp/i);

  // Turning notifications OFF remains allowed without providers.
  const off = await req('PUT', '/owner/config', {
    headers: { Authorization: `Bearer ${token}` },
    body: { notifyCustomerEmail: false, notifyCustomerWhatsapp: false },
  });
  assert.strictEqual(off.status, 200);
});

test('B4-6b. enabling customer email succeeds when SMTP is saved on the business', async () => {
  business = await makeBusiness();
  const token = ownerToken(business);
  const email = await req('PUT', '/owner/config', {
    headers: { Authorization: `Bearer ${token}` },
    body: { notifyCustomerEmail: true, smtpUser: 'owner@example.com', smtpPass: 'app-password' },
  });
  assert.strictEqual(email.status, 200, email.json?.error);
  assert.strictEqual(email.json.notifyCustomerEmail, true);
  assert.strictEqual(email.json.smtpConfigured, true);
});
