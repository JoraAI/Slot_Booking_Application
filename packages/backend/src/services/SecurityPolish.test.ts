import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import express from 'express';
import prisma from '../lib/prisma';
import { availabilityService } from './AvailabilityService';
import { publicRouter } from '../routes/public';
import { ownerRouter } from '../routes/owner';
import { timeService } from './TimeService';

/**
 * Batch 1E — security polish: embed origins, write-only Razorpay secret,
 * waitlist delete 404, next-available wiring.
 */

let server: any;
let baseUrl: string;
let business: any;
const createdIds: string[] = [];

function dateStr(days = 4): string {
  return timeService.toDateStr(new Date(Date.now() + days * 86400000), 'UTC');
}

async function req(method: string, path: string, opts: any = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json, headers: res.headers };
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
  const tag = crypto.randomBytes(4).toString('hex');
  business = await prisma.business.create({
    data: {
      name: 'SP',
      slug: `sp-${tag}`,
      publicCode: crypto.randomBytes(16).toString('base64url'),
      timezone: 'UTC',
      ownerEmail: `sp-${tag}@test.com`,
      ownerPassword: 'hashed',
      bookingWindowDays: 14,
      slotGranularityMinutes: 15,
      workingHours: { create: Array.from({ length: 7 }, (_, i) => ({ dayOfWeek: i, openTime: '09:00', closeTime: '18:00', isOpen: true })) },
    },
  });
  createdIds.push(business.id);
});

after(async () => {
  await prisma.business.deleteMany({ where: { id: { in: createdIds } } });
  createdIds.length = 0;
  server.close();
  await prisma.$disconnect();
});

test('1. embed origin: allowlisted origin passes, disallowed origin is 403, empty allowlist is permissive', async () => {
  const cfg = await req('GET', `/${business.publicCode}/config`);
  assert.strictEqual(cfg.status, 200);

  // Configure an allowlist
  await prisma.business.update({ where: { id: business.id }, data: { embedAllowedOrigins: ['https://salon.example'] } });

  const allowed = await req('GET', `/${business.publicCode}/config`, { headers: { Origin: 'https://salon.example' } });
  assert.strictEqual(allowed.status, 200, 'allowlisted origin allowed');

  const denied = await req('GET', `/${business.publicCode}/config`, { headers: { Origin: 'https://evil.example' } });
  assert.strictEqual(denied.status, 403, 'disallowed origin blocked');

  // No Origin header (direct navigation / QR / server-to-server) is never blocked
  const noOrigin = await req('GET', `/${business.publicCode}/config`);
  assert.strictEqual(noOrigin.status, 200);

  // Empty allowlist restores permissive behavior
  await prisma.business.update({ where: { id: business.id }, data: { embedAllowedOrigins: [] } });
  const permissive = await req('GET', `/${business.publicCode}/config`, { headers: { Origin: 'https://anything.example' } });
  assert.strictEqual(permissive.status, 200, 'empty allowlist is permissive');
});

test('2. razorpay secret is write-only and never returned', async () => {
  const token = jwt.sign({ businessId: business.id, email: business.ownerEmail }, process.env.JWT_SECRET || 'fallback-secret', { expiresIn: '1h' } as any);

  // /me never returns the secret, only the configured flag
  const me = await req('GET', '/owner/me', { headers: { Authorization: `Bearer ${token}` } });
  assert.strictEqual(me.status, 200);
  assert.ok(!('razorpayKeySecret' in me.json), 'secret not in /me');
  assert.strictEqual(me.json.razorpayKeySecretConfigured, false);

  // Write a secret: response shows configured, never the value
  const write = await req('PUT', '/owner/config', {
    headers: { Authorization: `Bearer ${token}` },
    body: { razorpayKeySecret: 'sh_secret_xyz' },
  });
  assert.strictEqual(write.status, 200);
  assert.ok(!('razorpayKeySecret' in write.json));
  assert.strictEqual(write.json.razorpayKeySecretConfigured, true);

  const row = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
  assert.strictEqual(row.razorpayKeySecret, 'sh_secret_xyz');

  // Blank update keeps the existing secret
  const blank = await req('PUT', '/owner/config', {
    headers: { Authorization: `Bearer ${token}` },
    body: { razorpayKeySecret: '' },
  });
  assert.strictEqual(blank.status, 200);
  assert.strictEqual(blank.json.razorpayKeySecretConfigured, true);
  const afterBlank = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
  assert.strictEqual(afterBlank.razorpayKeySecret, 'sh_secret_xyz', 'blank does not wipe the secret');

  // Explicit clear
  const clear = await req('PUT', '/owner/config', {
    headers: { Authorization: `Bearer ${token}` },
    body: { clearRazorpayKeySecret: true },
  });
  assert.strictEqual(clear.status, 200);
  assert.strictEqual(clear.json.razorpayKeySecretConfigured, false);
  const afterClear = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
  assert.strictEqual(afterClear.razorpayKeySecret, null);
});

test('3. waitlist delete returns a clean 404 for missing entries (public + owner)', async () => {
  await prisma.business.update({ where: { id: business.id }, data: { enableWaitlist: true } });

  const missing = await req('DELETE', `/${business.publicCode}/waitlist/missing-id`);
  assert.strictEqual(missing.status, 404);
  assert.strictEqual(missing.json.error, 'Waitlist entry not found');
  assert.ok(!/Record to delete/.test(missing.json.error), 'no raw Prisma error leak');

  const token = jwt.sign({ businessId: business.id, email: business.ownerEmail }, process.env.JWT_SECRET || 'fallback-secret', { expiresIn: '1h' } as any);
  const ownerMissing = await req('DELETE', '/owner/waitlist/missing-id', { headers: { Authorization: `Bearer ${token}` } });
  assert.strictEqual(ownerMissing.status, 404);
  assert.strictEqual(ownerMissing.json.error, 'Waitlist entry not found');
});

test('4. next-available returns a later date when the selected day has no slots', async () => {
  const cat = await prisma.serviceCategory.create({ data: { businessId: business.id, name: 'Cat' } });
  const svc = await prisma.service.create({
    data: { businessId: business.id, categoryId: cat.id, name: 'Svc', durationMinutes: 30, price: 100, resourceMode: 'POOLED', capacity: 1 },
    include: { workingHours: true, staff: true },
  });

  // Close the service for the target day (day-of-week), so that day yields no slots
  const target = dateStr();
  const dow = timeService.dayOfWeek(target);
  await prisma.serviceWorkingHour.create({
    data: { businessId: business.id, serviceId: svc.id, dayOfWeek: dow, openTime: '09:00', closeTime: '18:00', isOpen: false },
  });

  const result = await availabilityService.computeAvailability(business, svc, target);
  assert.strictEqual(result.slots.length, 0);
  assert.ok(result.nextAvailable, 'next available date returned');
  assert.notStrictEqual(result.nextAvailable, target);

  // The returned date actually has slots
  const next = await availabilityService.computeAvailability(business, svc, result.nextAvailable as string);
  assert.ok(next.slots.length > 0, 'next available date has slots');
});

test('5. unknown identifier resolves to a clean 404 everywhere (config + feature-guarded routes)', async () => {
  const missingCode = crypto.randomBytes(16).toString('base64url');

  const config = await req('GET', `/${missingCode}/config`);
  assert.strictEqual(config.status, 404);
  assert.strictEqual(config.json.error, 'Business not found');

  // featureGuard resolves through BusinessResolver, so an unknown identifier on
  // a feature-gated route is a clean 404, never a 500 or a feature error.
  const waitlist = await req('POST', `/${missingCode}/waitlist`, {
    body: { date: dateStr(), startTime: '10:00', customerName: 'A', customerPhone: '123' },
  });
  assert.strictEqual(waitlist.status, 404);
  assert.strictEqual(waitlist.json.error, 'Business not found');

  const payments = await req('POST', `/${missingCode}/payments/initiate`, { body: {} });
  assert.strictEqual(payments.status, 404);
  assert.strictEqual(payments.json.error, 'Business not found');
});

test('6. public config still works with embed=true query param', async () => {
  const res = await req('GET', `/${business.publicCode}/config?embed=true`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.business.publicCode, business.publicCode);
  assert.ok(Array.isArray(res.json.pageSections), 'pageSections present');

  const viaSlug = await req('GET', `/${business.slug}/config?embed=true`);
  assert.strictEqual(viaSlug.status, 200);
  assert.strictEqual(viaSlug.json.business.slug, business.slug);
});
