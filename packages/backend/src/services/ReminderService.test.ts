import { test, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { reminderService } from './ReminderService';
import { timeService } from './TimeService';

/**
 * Batch 1A — reminder correctness.
 * Proves that BOTH default offsets (1,440 and 120 minutes) are persisted per
 * enabled channel and that repeated scheduling is idempotent.
 */

let business: any;
let booking: any;

function futureDateStr(): string {
  return timeService.toDateStr(new Date(Date.now() + 4 * 86400000), 'UTC');
}

before(async () => {
  const tag = crypto.randomBytes(4).toString('hex');
  business = await prisma.business.create({
    data: {
      name: 'Reminder Test',
      slug: `reminder-test-${tag}`,
      publicCode: crypto.randomBytes(16).toString('base64url'),
      timezone: 'UTC',
      ownerEmail: `reminder-${tag}@test.com`,
      ownerPassword: 'hashed',
      bookingWindowDays: 14,
      remindersEnabled: true,
      reminderOffsetsMinutes: [1440, 120],
      notifyCustomerEmail: true,
      notifyCustomerWhatsapp: true,
    },
  });

  const dateStr = futureDateStr();
  booking = await prisma.booking.create({
    data: {
      businessId: business.id,
      date: timeService.dateToUtcMidnight(dateStr),
      startTime: '10:00',
      endTime: '10:30',
      status: 'CONFIRMED',
      customerName: 'Test',
      customerPhone: '+911111111111',
    },
  });
});

after(async () => {
  await prisma.bookingReminder.deleteMany({ where: { bookingId: booking.id } });
  await prisma.booking.delete({ where: { id: booking.id } });
  await prisma.business.delete({ where: { id: business.id } });
  await prisma.$disconnect();
});

test('1. both default offsets are persisted for every enabled channel', async () => {
  await prisma.bookingReminder.deleteMany({ where: { bookingId: booking.id } });
  const created = await reminderService.scheduleForBooking(business, booking);
  assert.strictEqual(created, 4, '2 offsets x 2 channels must be scheduled');

  const rows = await prisma.bookingReminder.findMany({
    where: { bookingId: booking.id },
    orderBy: [{ channel: 'asc' }, { offsetMinutes: 'asc' }],
  });
  assert.strictEqual(rows.length, 4);

  const emailOffsets = rows.filter((r) => r.channel === 'email').map((r) => r.offsetMinutes).sort((a, b) => (a ?? 0) - (b ?? 0));
  const waOffsets = rows.filter((r) => r.channel === 'whatsapp').map((r) => r.offsetMinutes).sort((a, b) => (a ?? 0) - (b ?? 0));
  assert.deepStrictEqual(emailOffsets, [120, 1440], 'email channel must carry both offsets');
  assert.deepStrictEqual(waOffsets, [120, 1440], 'whatsapp channel must carry both offsets');

  // scheduledFor must differ by exactly the offset gap (1320 minutes):
  // the 1440-min reminder fires 1320 minutes BEFORE the 120-min one
  const email120 = rows.find((r) => r.channel === 'email' && r.offsetMinutes === 120)!;
  const email1440 = rows.find((r) => r.channel === 'email' && r.offsetMinutes === 1440)!;
  const gapMinutes = (email120.scheduledFor.getTime() - email1440.scheduledFor.getTime()) / 60000;
  assert.strictEqual(gapMinutes, 1320, '1440-min reminder fires 1320 min before the 120-min one');
});

test('2. repeated scheduling is idempotent (no duplicate rows)', async () => {
  // Already scheduled by test 1; schedule again
  const createdAgain = await reminderService.scheduleForBooking(business, booking);
  assert.strictEqual(createdAgain, 0, 'no new rows for an already-scheduled booking');

  const count = await prisma.bookingReminder.count({ where: { bookingId: booking.id } });
  assert.strictEqual(count, 4, 'duplicate scheduling must not create duplicates');
});

test('3. cancelForBooking cancels pending reminders only', async () => {
  const cancelled = await reminderService.cancelForBooking(booking.id);
  assert.strictEqual(cancelled, 4, 'all four pending reminders are cancelled');

  const pending = await prisma.bookingReminder.count({
    where: { bookingId: booking.id, status: 'PENDING' },
  });
  assert.strictEqual(pending, 0);
  const cancelledRows = await prisma.bookingReminder.count({
    where: { bookingId: booking.id, status: 'CANCELLED' },
  });
  assert.strictEqual(cancelledRows, 4);

  // Cancel again: nothing left to cancel (idempotent)
  const secondCancel = await reminderService.cancelForBooking(booking.id);
  assert.strictEqual(secondCancel, 0);
});
