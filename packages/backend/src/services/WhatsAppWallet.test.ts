import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import express from 'express';
import prisma from '../lib/prisma';
import { bookingService } from './BookingService';
import { notificationService } from './NotificationService';
import { walletService } from './WalletService';
import { ownerRouter } from '../routes/owner';
import { publicRouter } from '../routes/public';
import { timeService } from './TimeService';

/**
 * Batch 5 — WhatsApp multi-tenant prepaid wallet acceptance tests.
 */

let business: any;
let server: any;
let baseUrl: string;
const createdBusinessIds: string[] = [];
const originalFetch = globalThis.fetch;

function dateStr(): string {
  return timeService.toDateStr(new Date(Date.now() + 4 * 86400000), 'UTC');
}

async function makeBusiness(overrides: any = {}) {
  const tag = crypto.randomBytes(4).toString('hex');
  const b = await prisma.business.create({
    data: {
      name: `Wallet ${tag}`,
      slug: `wallet-${tag}`,
      publicCode: crypto.randomBytes(16).toString('base64url'),
      timezone: 'UTC',
      ownerEmail: `wallet-${tag}@test.com`,
      ownerPassword: 'hashed',
      bookingWindowDays: 14,
      notifyCustomerEmail: false,
      notifyOwnerEmail: false,
      notifyCustomerWhatsapp: true,
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
    date: dateStr(), startTime: '10:00', serviceId: svc.id, staffId: staff.id,
    customerName: 'Test', customerPhone: '+919876543210', customerEmail: 'cust@example.com',
    formData: {},
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

beforeEach(() => {
  business = null;
  globalThis.fetch = originalFetch;
});

after(async () => {
  globalThis.fetch = originalFetch;
  await prisma.business.deleteMany({ where: { id: { in: createdBusinessIds } } });
  createdBusinessIds.length = 0;
  server.close();
  await prisma.$disconnect();
});

test('W5-1. Concurrency: two parallel reserves of 12 from balance 20 → one wins, one hard-stops, no negative balance', async () => {
  business = await makeBusiness();
  await walletService.creditRecharge(business.id, `pay_w5_1_${crypto.randomBytes(6).toString('hex')}`, 20, { description: 'seed' });

  const [r1, r2] = await Promise.all([
    walletService.reserve(business.id, 12, { description: 'a' }),
    walletService.reserve(business.id, 12, { description: 'b' }),
  ]);

  const okCount = [r1, r2].filter((r) => r.ok).length;
  assert.strictEqual(okCount, 1, 'exactly one reserve must succeed');
  const insufficient = [r1, r2].find((r) => !r.ok);
  assert.ok(insufficient && insufficient.ok === false);
  if (insufficient && !insufficient.ok) {
    assert.strictEqual(insufficient.reason, 'INSUFFICIENT_CREDITS');
  }
  const balance = await walletService.balance(business.id);
  assert.strictEqual(balance, 8, 'final balance must be 20 - 12 = 8, never negative');
});

test('W5-2. reserve → release restores the balance with an immutable ledger trail', async () => {
  business = await makeBusiness();
  await walletService.creditRecharge(business.id, `pay_w5_2_${crypto.randomBytes(6).toString('hex')}`, 100);

  const reservation = await walletService.reserve(business.id, 50, { description: 'test message' });
  assert.ok(reservation.ok);
  if (!reservation.ok) return;
  assert.strictEqual(await walletService.balance(business.id), 50);

  await walletService.releaseReservation(reservation.reservationId, 'meta rejected');
  assert.strictEqual(await walletService.balance(business.id), 100);

  const ledger = await prisma.walletTransaction.findMany({ where: { businessId: business.id }, orderBy: { createdAt: 'asc' } });
  assert.strictEqual(ledger.length, 3); // RECHARGE + RESERVATION + RESERVATION_RELEASE
  const reservationRow = ledger.find((t) => t.type === 'RESERVATION');
  assert.ok(reservationRow && reservationRow.status === 'CANCELLED');
  const release = ledger.find((t) => t.type === 'RESERVATION_RELEASE');
  assert.ok(release && release.amountPaise === 50);
});

test('W5-3. reserve → finalize keeps the charge and records WHATSAPP_CHARGE', async () => {
  business = await makeBusiness();
  await walletService.creditRecharge(business.id, `pay_w5_3_${crypto.randomBytes(6).toString('hex')}`, 100);

  const reservation = await walletService.reserve(business.id, 50, { description: 'msg' });
  assert.ok(reservation.ok);
  if (!reservation.ok) return;
  await walletService.finalizeReservation(reservation.reservationId, 'wamid.XYZ');

  assert.strictEqual(await walletService.balance(business.id), 50);
  const charge = await prisma.walletTransaction.findFirst({
    where: { businessId: business.id, type: 'WHATSAPP_CHARGE' },
  });
  assert.ok(charge && charge.status === 'COMPLETED' && charge.amountPaise === -50);
  const metadata: any = charge?.metadata ?? {};
  assert.strictEqual(metadata.providerMessageId, 'wamid.XYZ');
});

test('W5-4. Recharge is idempotent and cross-tenant replay is rejected', async () => {
  business = await makeBusiness();
  const other = await makeBusiness();

  const paymentId = `pay_w5_4_${crypto.randomBytes(6).toString('hex')}`;
  const first = await walletService.creditRecharge(business.id, paymentId, 5000, { description: 'top-up' });
  assert.strictEqual(first.alreadyCredited, false);
  assert.strictEqual(first.balancePaise, 5000);

  const again = await walletService.creditRecharge(business.id, paymentId, 5000, { description: 'duplicate' });
  assert.strictEqual(again.alreadyCredited, true);
  assert.strictEqual(again.balancePaise, 5000);

  const recharges = await prisma.walletTransaction.findMany({ where: { businessId: business.id, type: 'RECHARGE' } });
  assert.strictEqual(recharges.length, 1);

  await assert.rejects(
    () => walletService.creditRecharge(other.id, paymentId, 5000, { description: 'replay' }),
    /already used by another account/
  );
});

test('W5-5. Empty wallet → NO Meta call; booking confirmation still succeeds and logs INSUFFICIENT_CREDITS', async () => {
  business = await makeBusiness();
  process.env.META_WHATSAPP_PHONE_NUMBER_ID = '11223344556677889900';
  process.env.META_WHATSAPP_ACCESS_TOKEN = 'platform-token';
  await prisma.whatsAppConfig.upsert({
    where: { businessId: business.id },
    create: {
      businessId: business.id,
      connectionMode: 'SHARED',
      status: 'CONNECTED',
      enabled: true,
    },
    update: { connectionMode: 'SHARED', status: 'CONNECTED', enabled: true },
  });
  const wallet = await walletService.getWallet(business.id);
  assert.strictEqual(wallet.balancePaise, 0);

  let metaCalls = 0;
  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input?.url || input || '');
    if (url.includes('graph.facebook.com')) metaCalls++;
    return new Response(JSON.stringify({}), { status: 500 });
  }) as any;

  const { booking } = await makeBooking(business);
  await notificationService.sendBookingConfirmation(booking, business);

  assert.strictEqual(metaCalls, 0, 'hard stop: no Meta call when wallet is empty');
  assert.strictEqual(await walletService.balance(business.id), 0, 'no debit on insufficient credits');

  const log = await prisma.whatsAppMessageLog.findFirst({
    where: { businessId: business.id, bookingId: booking.id },
    orderBy: { createdAt: 'desc' },
  });
  assert.ok(log, 'message log row must exist');
  assert.strictEqual(log?.status, 'INSUFFICIENT_CREDITS');
  assert.strictEqual(log?.costPaise, 0);
});

test('W5-6. Wallet-funded send to a mocked Meta → ACCEPTED log + provider id + charge', async () => {
  business = await makeBusiness();
  process.env.META_WHATSAPP_PHONE_NUMBER_ID = '99887766554433221100';
  process.env.META_WHATSAPP_ACCESS_TOKEN = 'platform-token';
  await prisma.whatsAppConfig.upsert({
    where: { businessId: business.id },
    create: {
      businessId: business.id,
      connectionMode: 'SHARED',
      status: 'CONNECTED',
      enabled: true,
    },
    update: { connectionMode: 'SHARED', status: 'CONNECTED', enabled: true },
  });
  await walletService.creditRecharge(business.id, `pay_w5_6_${crypto.randomBytes(6).toString('hex')}`, 1000);

  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input?.url || input || '');
    if (url.includes('api.razorpay.com')) {
      return new Response(JSON.stringify({ id: 'ord_test', amount: 1000 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    assert.ok(url.includes('graph.facebook.com'), `unexpected fetch: ${url}`);
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.ACCEPTED1' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as any;

  const { booking } = await makeBooking(business);
  await notificationService.sendBookingConfirmation(booking, business);

  const balance = await walletService.balance(business.id);
  assert.strictEqual(balance, 900, '1000 - 100 (seeded UTILITY at 2× markup)');
  const log = await prisma.whatsAppMessageLog.findFirst({
    where: { businessId: business.id, bookingId: booking.id },
    orderBy: { createdAt: 'desc' },
  });
  assert.strictEqual(log?.status, 'ACCEPTED');
  assert.strictEqual(log?.providerMessageId, 'wamid.ACCEPTED1');
  assert.strictEqual(log?.costPaise, 50);
  const charge = await prisma.walletTransaction.findFirst({ where: { businessId: business.id, type: 'WHATSAPP_CHARGE' } });
  assert.ok(charge);
});

test('W5-7. Owner APIs: connect is SHARED opt-in, status never leaks tokens, recharge is gated', async () => {
  business = await makeBusiness();
  const token = ownerToken(business);
  process.env.META_WHATSAPP_PHONE_NUMBER_ID = '11112222333344';
  process.env.META_WHATSAPP_ACCESS_TOKEN = 'platform-secret-token';

  const connect = await req('POST', '/owner/whatsapp/connect', {
    headers: { Authorization: `Bearer ${token}` },
    body: {},
  });
  assert.strictEqual(connect.status, 200);
  assert.strictEqual(connect.json.status, 'CONNECTED');
  assert.strictEqual(connect.json.connectionMode, 'SHARED');

  const cfg = await prisma.whatsAppConfig.findUnique({ where: { businessId: business.id } });
  assert.strictEqual(cfg?.connectionMode, 'SHARED');
  assert.ok(!cfg?.accessTokenEnc);

  const status = await req('GET', '/owner/whatsapp/status', { headers: { Authorization: `Bearer ${token}` } });
  assert.strictEqual(status.status, 200);
  assert.strictEqual(status.json.status, 'CONNECTED');
  assert.ok(!JSON.stringify(status.json).includes('platform-secret-token'));
  assert.ok(!JSON.stringify(status.json).includes('accessTokenEnc'));
  assert.ok(typeof status.json.wallet.balancePaise === 'number');

  const oldKeyId = process.env.RAZORPAY_KEY_ID;
  process.env.RAZORPAY_KEY_ID = '';
  const recharge = await req('POST', '/owner/whatsapp-wallet/recharge', {
    headers: { Authorization: `Bearer ${token}` },
    body: { amountPaise: 50000 },
  });
  assert.strictEqual(recharge.status, 500);
  process.env.RAZORPAY_KEY_ID = oldKeyId;

  const oldKeySecret = process.env.RAZORPAY_KEY_SECRET;
  process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
  process.env.RAZORPAY_KEY_SECRET = 'secret';
  const verify = await req('POST', '/owner/whatsapp-wallet/verify', {
    headers: { Authorization: `Bearer ${token}` },
    body: { razorpay_order_id: 'order_bad', razorpay_payment_id: 'pay_bad', razorpay_signature: 'not-a-signature' },
  });
  assert.strictEqual(verify.status, 400);
  process.env.RAZORPAY_KEY_ID = oldKeyId;
  process.env.RAZORPAY_KEY_SECRET = oldKeySecret;

  const disconnect = await req('POST', '/owner/whatsapp/disconnect', { headers: { Authorization: `Bearer ${token}` }, body: {} });
  assert.strictEqual(disconnect.status, 200);
  assert.strictEqual(disconnect.json.status, 'DISCONNECTED');
});

test('W5-8. Tenant isolation: business A can only see its own wallet + ledger', async () => {
  business = await makeBusiness();
  const other = await makeBusiness();
  await walletService.creditRecharge(business.id, `pay_w5_8a_${crypto.randomBytes(6).toString('hex')}`, 500);
  await walletService.creditRecharge(other.id, `pay_w5_8b_${crypto.randomBytes(6).toString('hex')}`, 9999);

  const tokenA = ownerToken(business);
  const wallet = await req('GET', '/owner/whatsapp-wallet', { headers: { Authorization: `Bearer ${tokenA}` } });
  assert.strictEqual(wallet.status, 200);
  assert.strictEqual(wallet.json.balancePaise, 500);

  const tx = await req('GET', '/owner/whatsapp-wallet/transactions', { headers: { Authorization: `Bearer ${tokenA}` } });
  assert.strictEqual(tx.status, 200);
  assert.ok(Array.isArray(tx.json.transactions));
  assert.ok(tx.json.transactions.every((t: any) => t.businessId === business.id));
  assert.strictEqual(tx.json.transactions.length, 1);
});
