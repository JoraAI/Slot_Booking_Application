import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { availabilityService } from './AvailabilityService';
import { timeService } from './TimeService';

/**
 * Availability engine tests covering the scenarios in the V4 enhancement spec
 * (section 10.12). Uses an isolated test business (UTC timezone) and cleans up
 * after itself. Run with: pnpm --filter backend test
 */

let business: any;
let category: any;
const staffA: any = {};
const staffB: any = {};

function dateStr(daysAhead = 3): string {
  return timeService.toDateStr(new Date(Date.now() + daysAhead * 86400000), 'UTC');
}

async function makeService(overrides: any = {}) {
  return prisma.service.create({
    data: {
      businessId: business.id,
      categoryId: category.id,
      name: `Test-${crypto.randomBytes(4).toString('hex')}`,
      durationMinutes: 30,
      bufferMinutes: 0,
      price: 100,
      resourceMode: 'POOLED',
      capacity: 1,
      ...overrides,
    },
    include: { staff: true, workingHours: true },
  });
}

async function addBooking(service: any, staffId: string | null, startTime: string, dStr: string, forBusinessId?: string) {
  return prisma.booking.create({
    data: {
      businessId: forBusinessId || business.id,
      serviceId: service.id,
      staffId,
      date: timeService.dateToUtcMidnight(dStr),
      startTime,
      endTime: (() => {
        const [h, m] = startTime.split(':').map(Number);
        const end = h * 60 + m + service.durationMinutes;
        return `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
      })(),
      status: 'CONFIRMED',
      customerName: 'Test',
      customerPhone: '+911111111111',
      durationMinutesSnapshot: service.durationMinutes,
      bufferMinutesSnapshot: service.bufferMinutes || 0,
    },
  });
}

async function slotStarts(service: any, dStr: string, staffId?: string): Promise<string[]> {
  const result = await availabilityService.computeAvailability(business, service, dStr, staffId);
  return result.slots.map((s) => s.startTime);
}

before(async () => {
  const tag = crypto.randomBytes(4).toString('hex');
  business = await prisma.business.create({
    data: {
      name: 'Availability Test',
      slug: `avail-test-${tag}`,
      publicCode: crypto.randomBytes(16).toString('base64url'),
      timezone: 'UTC',
      ownerEmail: `avail-${tag}@test.com`,
      ownerPassword: 'hashed',
      bookingWindowDays: 14,
      slotGranularityMinutes: 30,
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
    include: { workingHours: true },
  });
  category = await prisma.serviceCategory.create({ data: { businessId: business.id, name: 'Test Cat' } });
  staffA.row = await prisma.staff.create({ data: { businessId: business.id, name: 'Staff A' } });
  staffB.row = await prisma.staff.create({ data: { businessId: business.id, name: 'Staff B' } });
});

// Each test uses the same booking window date; clean state between tests.
beforeEach(async () => {
  await prisma.booking.deleteMany({ where: { businessId: business.id } });
  await prisma.blockedSlot.deleteMany({ where: { businessId: business.id } });
  await prisma.serviceWorkingHour.deleteMany({ where: { businessId: business.id } });
});

after(async () => {
  await prisma.booking.deleteMany({ where: { businessId: business.id } });
  await prisma.blockedSlot.deleteMany({ where: { businessId: business.id } });
  await prisma.staff.deleteMany({ where: { businessId: business.id } });
  await prisma.service.deleteMany({ where: { businessId: business.id } });
  await prisma.serviceCategory.deleteMany({ where: { businessId: business.id } });
  await prisma.business.delete({ where: { id: business.id } });
  await prisma.$disconnect();
});

test('1. 30-min service: 09:00 and 09:30 occupied; next is 10:00', async () => {
  const d = dateStr();
  const service = await makeService();
  await addBooking(service, null, '09:00', d);
  await addBooking(service, null, '09:30', d);
  const starts = await slotStarts(service, d);
  assert.ok(!starts.includes('09:00'));
  assert.ok(!starts.includes('09:30'));
  assert.ok(starts.includes('10:00'));
  await prisma.service.delete({ where: { id: service.id } });
});

test('2. Two-hour service not offered in a 45-minute gap', async () => {
  const d = dateStr();
  const service = await makeService({ durationMinutes: 120, bufferMinutes: 0 });
  // 09:00-09:45 existing booking (30min visible), gap until 09:45
  await addBooking(service, null, '09:00', d);
  await addBooking(service, null, '09:45', d);
  const starts = await slotStarts(service, d);
  // A 2h service cannot start between 09:00 and 09:45 and fit before the next booking
  assert.ok(!starts.includes('09:00'));
  assert.ok(!starts.includes('09:15'));
  assert.ok(!starts.includes('09:30'));
  await prisma.service.delete({ where: { id: service.id } });
});

test('3. Pool capacity three permits three overlapping bookings and rejects the fourth', async () => {
  const d = dateStr();
  const service = await makeService({ resourceMode: 'POOLED', capacity: 3 });
  await addBooking(service, null, '10:00', d);
  await addBooking(service, null, '10:00', d);
  await addBooking(service, null, '10:00', d);
  const result = await availabilityService.computeAvailability(business, service, d);
  const ten = result.slots.find((s) => s.startTime === '10:00');
  assert.ok(!ten, 'fourth overlapping booking must be rejected (10:00 full)');
  const ten30 = result.slots.find((s) => s.startTime === '10:30');
  assert.ok(ten30, '10:30 must remain available');
  await prisma.service.delete({ where: { id: service.id } });
});

test('4. Staff A occupied while Staff B remains eligible', async () => {
  const d = dateStr();
  const service = await makeService({
    resourceMode: 'STAFF_BASED',
    staff: {
      create: [
        { staffId: staffA.row.id, businessId: business.id },
        { staffId: staffB.row.id, businessId: business.id },
      ],
    },
  });
  await addBooking(service, staffA.row.id, '11:00', d);
  const result = await availabilityService.computeAvailability(business, service, d, staffB.row.id);
  assert.ok(result.slots.some((s) => s.startTime === '11:00'), 'Staff B must remain eligible at 11:00');
  const resultA = await availabilityService.computeAvailability(business, service, d, staffA.row.id);
  assert.ok(!resultA.slots.some((s) => s.startTime === '11:00'), 'Staff A must be busy at 11:00');
  await prisma.service.delete({ where: { id: service.id } });
});

test('5. Service-specific hours restrict slots', async () => {
  const d = dateStr();
  const service = await makeService();
  const dow = timeService.dayOfWeek(d);
  await prisma.serviceWorkingHour.create({
    data: { businessId: business.id, serviceId: service.id, dayOfWeek: dow, openTime: '11:00', closeTime: '16:00', isOpen: true },
  });
  const starts = await slotStarts(service, d);
  assert.ok(!starts.includes('09:00'), 'no slots before 11:00');
  assert.ok(starts.includes('11:00'), 'slot at 11:00');
  assert.ok(!starts.includes('16:00'), 'no slot at/after 16:00 for 30-min service');
  assert.ok(starts.includes('15:30'), 'last valid slot 15:30');
  await prisma.service.delete({ where: { id: service.id } });
});

test('6. Buffer prevents the next overlap', async () => {
  const d = dateStr();
  const service = await makeService({ durationMinutes: 30, bufferMinutes: 15 });
  await addBooking(service, null, '12:00', d);
  const starts = await slotStarts(service, d);
  // 12:00 occupies 12:00-12:45 (30min + 15 buffer); at 30-min granularity the
  // next non-overlapping candidate is 13:00
  assert.ok(!starts.includes('12:30'));
  assert.ok(starts.includes('13:00'), '13:00 is the first non-overlapping slot');
  await prisma.service.delete({ where: { id: service.id } });
});

test('7+8. Closing boundary: service ending exactly at close is valid; beyond is invalid', async () => {
  const d = dateStr();
  const ok = await makeService({ durationMinutes: 30, bufferMinutes: 0 });
  const starts = await slotStarts(ok, d);
  assert.ok(starts.includes('17:30'), '30-min service ending exactly at 18:00 closing is valid');
  await prisma.service.delete({ where: { id: ok.id } });

  const overflow = await makeService({ durationMinutes: 45, bufferMinutes: 0 });
  const starts2 = await slotStarts(overflow, d);
  assert.ok(!starts2.includes('17:30'), '45-min service cannot start at 17:30 (ends past closing)');
  await prisma.service.delete({ where: { id: overflow.id } });
});

test('9. Global blocked slot', async () => {
  const d = dateStr();
  const service = await makeService();
  await prisma.blockedSlot.create({
    data: { businessId: business.id, date: timeService.dateToUtcMidnight(d), startTime: '13:00', endTime: '14:00' },
  });
  const starts = await slotStarts(service, d);
  assert.ok(!starts.includes('13:00'));
  assert.ok(starts.includes('14:00'));
  await prisma.service.delete({ where: { id: service.id } });
});

test('10. Staff-only blocked slot does not affect a pooled service', async () => {
  const d = dateStr();
  const service = await makeService();
  await prisma.blockedSlot.create({
    data: { businessId: business.id, staffId: staffA.row.id, date: timeService.dateToUtcMidnight(d), startTime: '14:00', endTime: '15:00' },
  });
  const starts = await slotStarts(service, d);
  assert.ok(starts.includes('14:00'), 'staff-only block must not affect pooled service');
  await prisma.service.delete({ where: { id: service.id } });
});

test('11. Existing interval starts inside candidate interval', async () => {
  const d = dateStr();
  const service = await makeService({ durationMinutes: 60, bufferMinutes: 0 });
  await addBooking(service, null, '09:30', d); // occupies 09:30-10:30
  const starts = await slotStarts(service, d);
  // Candidate 09:00-10:00 contains 09:30 (starts inside) -> invalid.
  // Candidate 10:00-11:00 also overlaps 09:30-10:30 -> invalid at 30-min granularity.
  assert.ok(!starts.includes('09:00'));
  assert.ok(starts.includes('10:30'), '10:30-11:30 is the first valid slot');
  await prisma.service.delete({ where: { id: service.id } });
});

test('12. Existing interval surrounds candidate interval', async () => {
  const d = dateStr();
  const service = await makeService({ durationMinutes: 60, bufferMinutes: 0 });
  // booking 09:30-10:30; candidate 09:00-10:00 surrounds? No — existing is inside candidate.
  // Use a longer existing booking: 09:00-11:00 (create directly with 120min snapshot)
  await prisma.booking.create({
    data: {
      businessId: business.id,
      serviceId: service.id,
      date: timeService.dateToUtcMidnight(d),
      startTime: '09:00',
      endTime: '11:00',
      status: 'CONFIRMED',
      customerName: 'Test',
      customerPhone: '+911111111111',
      durationMinutesSnapshot: 120,
      bufferMinutesSnapshot: 0,
    },
  });
  const starts = await slotStarts(service, d);
  assert.ok(!starts.includes('10:00'), 'candidate 10:00-11:00 lies inside existing 09:00-11:00');
  await prisma.service.delete({ where: { id: service.id } });
});

test('13. No eligible staff => no slots', async () => {
  const d = dateStr();
  const service = await makeService({ resourceMode: 'STAFF_BASED', staff: { create: [] } });
  const starts = await slotStarts(service, d);
  assert.strictEqual(starts.length, 0);
  await prisma.service.delete({ where: { id: service.id } });
});

// 14. Timezone day boundary: handled implicitly by all tests using UTC; the
// timezone engine converts business-local dates to UTC midnight consistently.
test('14. Timezone day boundary (Asia/Kolkata offset 5:30)', async () => {
  const b = await prisma.business.create({
    data: {
      name: 'TZ Test',
      slug: `tz-test-${crypto.randomBytes(4).toString('hex')}`,
      publicCode: crypto.randomBytes(16).toString('base64url'),
      timezone: 'Asia/Kolkata',
      ownerEmail: `tz-${Date.now()}@test.com`,
      ownerPassword: 'x',
      bookingWindowDays: 14,
      slotGranularityMinutes: 30,
      workingHours: { create: [{ dayOfWeek: 0, openTime: '09:00', closeTime: '18:00', isOpen: true }] },
    },
  });
  const cat = await prisma.serviceCategory.create({ data: { businessId: b.id, name: 'Cat' } });
  const svc = await prisma.service.create({
    data: { businessId: b.id, categoryId: cat.id, name: 'T', durationMinutes: 30, price: 1 },
    include: { workingHours: true, staff: true },
  });
  // The date is a Sunday in IST; booking stored at UTC midnight must align with queries
  const sunday = timeService.todayStr('Asia/Kolkata');
  const sundayDow = timeService.dayOfWeek(sunday);
  let target = sunday;
  if (sundayDow !== 0) {
    const [y, m, dd] = sunday.split('-').map(Number);
    target = timeService.toDateStr(new Date(Date.UTC(y, m - 1, dd + (7 - sundayDow))), 'UTC');
  }
  await addBooking(svc, null, '10:00', target, b.id);
  const result = await availabilityService.computeAvailability(b, svc, target);
  assert.ok(!result.slots.some((s) => s.startTime === '10:00'), 'booked slot must be excluded across the timezone boundary');
  assert.ok(result.slots.some((s) => s.startTime === '11:00'), 'following slot available');
  await prisma.booking.deleteMany({ where: { businessId: b.id } });
  await prisma.service.deleteMany({ where: { businessId: b.id } });
  await prisma.serviceCategory.deleteMany({ where: { businessId: b.id } });
  await prisma.business.delete({ where: { id: b.id } });
});
