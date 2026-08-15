import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { waitlistService } from './WaitlistService';
import { timeService } from './TimeService';

/**
 * Batch 1D — durable waitlist expiry (DB-backed, cron-processed).
 */

let business: any;
let category: any;
let service: any;
const createdIds: string[] = [];

function dateStr(days = 4): string {
  return timeService.toDateStr(new Date(Date.now() + days * 86400000), 'UTC');
}

async function makeBusiness(tz = 'UTC') {
  const tag = crypto.randomBytes(4).toString('hex');
  const b = await prisma.business.create({
    data: {
      name: `WL ${tag}`,
      slug: `wl-${tag}`,
      publicCode: crypto.randomBytes(16).toString('base64url'),
      timezone: tz,
      ownerEmail: `wl-${tag}@test.com`,
      ownerPassword: 'hashed',
      bookingWindowDays: 14,
      enableWaitlist: true,
      slotGranularityMinutes: 15,
      workingHours: {
        create: Array.from({ length: 7 }, (_, i) => ({ dayOfWeek: i, openTime: '09:00', closeTime: '18:00', isOpen: true })),
      },
    },
  });
  createdIds.push(b.id);
  return b;
}

async function makeService(b: any) {
  const cat = await prisma.serviceCategory.create({ data: { businessId: b.id, name: 'Cat' } });
  const svc = await prisma.service.create({
    data: { businessId: b.id, categoryId: cat.id, name: 'Svc', durationMinutes: 30, price: 100, resourceMode: 'POOLED', capacity: 1 },
    include: { workingHours: true, staff: true },
  });
  return { cat, svc };
}

async function addEntry(b: any, svc: any, startTime: string, notified = false) {
  const entry = await prisma.waitlistEntry.create({
    data: {
      businessId: b.id,
      serviceId: svc.id,
      date: timeService.dateToUtcMidnight(dateStr()),
      startTime,
      customerName: 'Test',
      customerPhone: '+911111111111',
    },
  });
  if (notified) {
    await prisma.waitlistEntry.update({
      where: { id: entry.id },
      data: { notified: true, notifiedAt: new Date(), expiresAt: new Date(Date.now() - 1000) },
    });
  }
  return entry;
}

before(async () => {
  business = await makeBusiness();
  const made = await makeService(business);
  category = made.cat;
  service = made.svc;
});

beforeEach(async () => {
  await prisma.booking.deleteMany({ where: { businessId: business.id } });
  await prisma.waitlistEntry.deleteMany({ where: { businessId: business.id } });
});

after(async () => {
  await prisma.business.deleteMany({ where: { id: { in: createdIds } } });
  createdIds.length = 0;
  await prisma.$disconnect();
});

test('1. notified entry expires after expiresAt; processor is idempotent', async () => {
  const entry = await addEntry(business, service, '10:00', true);

  const n = await waitlistService.processExpired(new Date());
  assert.strictEqual(n, 1);
  const row = await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: entry.id } });
  assert.strictEqual(row.expired, true);

  // Idempotent: nothing left to process
  const again = await waitlistService.processExpired(new Date());
  assert.strictEqual(again, 0);
});

test('2. cascade notifies next only if the slot is still available for that service', async () => {
  // Scenario A: slot available -> next entry is notified
  const e1 = await addEntry(business, service, '10:00', true);
  const e2 = await addEntry(business, service, '10:00', false);
  await waitlistService.processExpired(new Date());
  const e2row = await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: e2.id } });
  assert.strictEqual(e2row.notified, true, 'next entry notified when slot is available');
  assert.ok(e2row.expiresAt, 'notified entry gets a DB-backed expiresAt');

  // Scenario B: slot now occupied -> next entry must NOT be notified
  const e3 = await addEntry(business, service, '11:00', true);
  const e4 = await addEntry(business, service, '11:00', false);
  await prisma.booking.create({
    data: {
      businessId: business.id,
      serviceId: service.id,
      date: timeService.dateToUtcMidnight(dateStr()),
      startTime: '11:00',
      endTime: '11:30',
      status: 'CONFIRMED',
      customerName: 'Other',
      customerPhone: '+912222222222',
      durationMinutesSnapshot: 30,
      bufferMinutesSnapshot: 0,
    },
  });
  await waitlistService.processExpired(new Date());
  const e4row = await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: e4.id } });
  assert.strictEqual(e4row.notified, false, 'next entry NOT notified when slot is unavailable');
  assert.strictEqual(e4row.expired, false);
});

test('3. notified entries get a 30-minute DB-backed expiresAt (no in-process timer)', async () => {
  const entry = await addEntry(business, service, '12:00', false);
  await waitlistService.manuallyNotify(business.id, entry.id);
  const row = await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: entry.id } });
  assert.strictEqual(row.notified, true);
  assert.ok(row.expiresAt, 'expiresAt is set');
  const holdMs = row.expiresAt!.getTime() - Date.now();
  assert.ok(Math.abs(holdMs - 30 * 60000) < 60000, `hold is ~30 minutes (got ${holdMs / 60000} min)`);
});

test('4. waitlist date comparisons stay business-local correct (Asia/Kolkata +5:30)', async () => {
  const biz = await makeBusiness('Asia/Kolkata');
  const made = await makeService(biz);
  const kolkataDate = timeService.toDateStr(new Date(Date.now() + 3 * 86400000), 'Asia/Kolkata');

  const entry = await waitlistService.addToWaitlist(biz.publicCode, {
    date: kolkataDate,
    startTime: '10:00',
    customerName: 'Test',
    customerPhone: '+911111111111',
    serviceId: made.svc.id,
  });

  const list = await waitlistService.getWaitlistForSlot(biz.id, kolkataDate, '10:00');
  assert.ok(list.some((e) => e.id === entry.id), 'entry found with business-local date string');
});
