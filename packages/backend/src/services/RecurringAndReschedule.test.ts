import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import express from 'express';
import prisma from '../lib/prisma';
import { recurringService } from './RecurringService';
import { reminderService } from './ReminderService';
import { bookingService } from './BookingService';
import { ownerRouter } from '../routes/owner';
import { publicRouter } from '../routes/public';
import { timeService } from './TimeService';

/**
 * Batch 1D — recurring timezone purity + reschedule reminder rebuild.
 */

let business: any;
let category: any;
let service: any;
let staff: any;
let staffBasedService: any;
let server: any;
let baseUrl: string;
const createdIds: string[] = [];

function dateStr(days = 4): string {
  return timeService.toDateStr(new Date(Date.now() + days * 86400000), 'UTC');
}

before(async () => {
  const tag = crypto.randomBytes(4).toString('hex');
  business = await prisma.business.create({
    data: {
      name: `RR ${tag}`,
      slug: `rr-${tag}`,
      publicCode: crypto.randomBytes(16).toString('base64url'),
      timezone: 'UTC',
      ownerEmail: `rr-${tag}@test.com`,
      ownerPassword: 'hashed',
      bookingWindowDays: 30,
      slotGranularityMinutes: 15,
      enableRecurring: true,
      remindersEnabled: true,
      reminderOffsetsMinutes: [1440, 120],
      notifyCustomerEmail: true,
      notifyCustomerWhatsapp: false,
      workingHours: {
        create: Array.from({ length: 7 }, (_, i) => ({ dayOfWeek: i, openTime: '09:00', closeTime: '18:00', isOpen: true })),
      },
    },
  });
  createdIds.push(business.id);
  category = await prisma.serviceCategory.create({ data: { businessId: business.id, name: 'Cat' } });
  staff = await prisma.staff.create({ data: { businessId: business.id, name: 'Staff' } });
  service = await prisma.service.create({
    data: {
      businessId: business.id,
      categoryId: category.id,
      name: 'Svc',
      durationMinutes: 30,
      price: 100,
      resourceMode: 'POOLED',
      capacity: 1,
    },
    include: { workingHours: true, staff: true },
  });
  staffBasedService = await prisma.service.create({
    data: {
      businessId: business.id,
      categoryId: category.id,
      name: 'Staff Svc',
      durationMinutes: 30,
      price: 100,
      resourceMode: 'STAFF_BASED',
      capacity: 1,
      staff: { create: [{ businessId: business.id, staffId: staff.id }] },
    },
    include: { workingHours: true, staff: true },
  });

  const app = express();
  app.use(express.json());
  app.use('/api/owner', ownerRouter);
  app.use('/api', publicRouter);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

beforeEach(async () => {
  // Scope cleanup to this test file's own bookings — a global wipe would race
  // with ReminderService.test.ts running in the same parallel suite.
  await prisma.bookingReminder.deleteMany({ where: { booking: { businessId: business.id } } });
  await prisma.booking.deleteMany({ where: { businessId: business.id } });
});

after(async () => {
  await prisma.bookingReminder.deleteMany({ where: { booking: { businessId: business.id } } });
  await prisma.booking.deleteMany({ where: { businessId: business.id } });
  await prisma.business.deleteMany({ where: { id: { in: createdIds } } });
  createdIds.length = 0;
  server.close();
  await prisma.$disconnect();
});

test('1. recurring date generation is timezone-pure across Asia/Kolkata', async () => {
  const dates = recurringService.generateDates('2026-08-16', 'weekly', 3, 'Asia/Kolkata');
  assert.strictEqual(dates.length, 3);
  assert.strictEqual(dates[0], '2026-08-16');
  const d1 = timeService.dayOfWeek(dates[0]);
  const d2 = timeService.dayOfWeek(dates[1]);
  const d3 = timeService.dayOfWeek(dates[2]);
  assert.strictEqual(d2, d1, 'weekly occurrences share the same Kolkata weekday');
  assert.strictEqual(d3, d1);
  const [yy1, mm1, dd1] = dates[1].split('-').map(Number);
  const [yy0, mm0, dd0] = dates[0].split('-').map(Number);
  const diff = (Date.UTC(yy1, mm1 - 1, dd1) - Date.UTC(yy0, mm0 - 1, dd0)) / 86400000;
  assert.strictEqual(diff, 7, 'occurrences are exactly 7 days apart');

  const monthly = recurringService.generateDates('2026-08-16', 'monthly', 3, 'Asia/Kolkata');
  assert.strictEqual(monthly.length, 3);
  assert.strictEqual(monthly[0], '2026-08-16');
  assert.strictEqual(monthly[1], '2026-09-16', 'monthly stays on the same day-of-month in Kolkata');
  assert.strictEqual(monthly[2], '2026-10-16');
});

test('2. rescheduling via owner PUT cancels pending reminders and schedules fresh ones', async () => {
  const booking = await bookingService.createBooking(business.publicCode, {
    date: dateStr(),
    startTime: '10:00',
    serviceId: service.id,
    customerName: 'Test',
    customerPhone: '+911111111111',
  });
  await reminderService.scheduleForBooking(business, booking);
  assert.strictEqual(await prisma.bookingReminder.count({ where: { bookingId: booking.id, status: 'PENDING' } }), 2);

  const token = jwt.sign({ businessId: business.id, email: business.ownerEmail }, process.env.JWT_SECRET || 'fallback-secret', { expiresIn: '1h' } as any);
  const newDate = dateStr(5);
  const res = await fetch(`${baseUrl}/owner/bookings/${booking.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ date: newDate, startTime: '11:00' }),
  });
  assert.strictEqual(res.status, 200);

  const pending = await prisma.bookingReminder.findMany({ where: { bookingId: booking.id, status: 'PENDING' } });
  assert.strictEqual(pending.length, 2, 'exactly two fresh reminders remain after rebuild');
  assert.deepStrictEqual(pending.map((r) => r.offsetMinutes).sort((a, b) => (a ?? 0) - (b ?? 0)), [120, 1440]);
  const startUtc = timeService.toUtc('UTC', newDate, '11:00').getTime();
  for (const r of pending) {
    assert.ok(Math.abs(r.scheduledFor.getTime() - (startUtc - (r.offsetMinutes || 0) * 60000)) < 1000, 'fresh reminder anchored to new time');
  }
  // No stale reminders remain scheduled for the old time
  const stale = await prisma.bookingReminder.count({
    where: { bookingId: booking.id, status: 'PENDING', scheduledFor: { lt: new Date(Date.now()) } },
  });
  assert.strictEqual(stale, 0);
});

test('3. cancel path (owner DELETE) cancels pending reminders', async () => {
  const booking = await bookingService.createBooking(business.publicCode, {
    date: dateStr(),
    startTime: '10:00',
    serviceId: service.id,
    customerName: 'Test',
    customerPhone: '+911111111111',
  });
  await reminderService.scheduleForBooking(business, booking);
  assert.strictEqual(await prisma.bookingReminder.count({ where: { bookingId: booking.id, status: 'PENDING' } }), 2);

  const token = jwt.sign({ businessId: business.id, email: business.ownerEmail }, process.env.JWT_SECRET || 'fallback-secret', { expiresIn: '1h' } as any);
  const res = await fetch(`${baseUrl}/owner/bookings/${booking.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.strictEqual(res.status, 200);

  const cancelled = await prisma.bookingReminder.count({ where: { bookingId: booking.id, status: 'CANCELLED' } });
  const pending = await prisma.bookingReminder.count({ where: { bookingId: booking.id, status: 'PENDING' } });
  assert.strictEqual(cancelled, 2, 'cancellation cancels pending reminders');
  assert.strictEqual(pending, 0);
});

test('4. direct STAFF_BASED booking auto-assigns staff when no preference is supplied', async () => {
  const booking = await bookingService.createBooking(business.publicCode, {
    date: dateStr(),
    startTime: '12:00',
    serviceId: staffBasedService.id,
    staffId: null,
    customerName: 'Any Staff',
    customerPhone: '+911111111111',
  });

  assert.strictEqual(booking.staffId, staff.id);
});

test('5. recurring STAFF_BASED booking auto-assigns staff for every occurrence', async () => {
  const result = await recurringService.createRecurringBooking(business.publicCode, {
    startDate: dateStr(),
    startTime: '13:00',
    serviceId: staffBasedService.id,
    staffId: null,
    customerName: 'Recurring Any Staff',
    customerPhone: '+911111111111',
    frequency: 'weekly',
    count: 2,
  });

  assert.strictEqual(result.conflicts.length, 0);
  assert.strictEqual(result.bookings.length, 2);
  assert.ok(result.bookings.every((booking) => booking.staffId === staff.id));
});

test('6. rescheduling with Any Available keeps a STAFF_BASED booking assigned', async () => {
  const booking = await bookingService.createBooking(business.publicCode, {
    date: dateStr(),
    startTime: '14:00',
    serviceId: staffBasedService.id,
    customerName: 'Reschedule Any Staff',
    customerPhone: '+911111111111',
  });

  const updated = await bookingService.updateBooking(business.publicCode, booking.id, {
    startTime: '15:00',
    staffId: null,
  });

  assert.strictEqual(updated.staffId, staff.id);
  assert.strictEqual(updated.startTime, '15:00');
});
