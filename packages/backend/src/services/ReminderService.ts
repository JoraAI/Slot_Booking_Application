import prisma from '../lib/prisma';
import { timeService } from './TimeService';
import { notificationService } from './NotificationService';

const MAX_ATTEMPTS = 3;
const BATCH_LIMIT = 50;

/**
 * Database-backed booking reminders. Survives process restarts and free-host
 * sleeping; no long-lived setTimeout. Processing is idempotent (status guard)
 * and retry-limited.
 */
class ReminderService {
  /**
   * Schedule reminders for a new/rescheduled booking from the business's
   * configured offsets and enabled channels. Reminders are scheduled relative
   * to the business-local appointment time.
   */
  async scheduleForBooking(business: {
    id: string;
    timezone: string;
    remindersEnabled: boolean;
    reminderOffsetsMinutes: number[];
    notifyCustomerEmail: boolean;
    notifyCustomerWhatsapp: boolean;
  }, booking: {
    id: string;
    date: Date;
    startTime: string;
  }): Promise<number> {
    if (!business.remindersEnabled) return 0;
    const offsets = (business.reminderOffsetsMinutes || []).filter(
      (o) => Number.isFinite(o) && o > 0
    );
    if (offsets.length === 0) return 0;

    const tz = business.timezone || 'Asia/Kolkata';
    const dateStr = timeService.toDateStr(booking.date, tz);
    const startUtc = timeService.toUtc(tz, dateStr, booking.startTime);

    const channels: string[] = [];
    if (business.notifyCustomerEmail) channels.push('email');
    if (business.notifyCustomerWhatsapp) channels.push('whatsapp');

    let scheduled = 0;
    for (const offset of offsets) {
      const scheduledFor = new Date(startUtc.getTime() - offset * 60000);
      for (const channel of channels) {
        const data = {
          businessId: business.id,
          bookingId: booking.id,
          channel,
          reminderType: 'BOOKING_REMINDER' as const,
          offsetMinutes: offset,
          scheduledFor,
        };
        // `skipDuplicates` turns the expected P2002 (same unique key, e.g. on
        // reschedule rebuild) into a silent no-op instead of a prisma:error log.
        const created = await prisma.bookingReminder.createMany({ data: [data], skipDuplicates: true });
        if (created.count > 0) {
          scheduled++;
          continue;
        }
        // Same (bookingId, channel, reminderType, offsetMinutes) already
        // exists. Reactivate it when it was previously cancelled (reschedule
        // rebuild); otherwise scheduling stays idempotent.
        const existing = await prisma.bookingReminder.findFirst({
          where: { bookingId: booking.id, channel, reminderType: 'BOOKING_REMINDER', offsetMinutes: offset },
        });
        if (existing?.status === 'CANCELLED') {
          await prisma.bookingReminder.update({
            where: { id: existing.id },
            data: { status: 'PENDING', scheduledFor, attempts: 0, lastError: null, sentAt: null },
          });
          scheduled++;
        }
      }
    }
    return scheduled;
  }

  /** Cancel pending reminders for a booking (e.g. on cancellation). */
  async cancelForBooking(bookingId: string, client: any = prisma): Promise<number> {
    const result = await client.bookingReminder.updateMany({
      where: { bookingId, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    return result.count;
  }

  /** Process reminders that are due. Returns the number processed. */
  async processDue(now: Date = new Date()): Promise<number> {
    const due = await prisma.bookingReminder.findMany({
      where: { status: 'PENDING', scheduledFor: { lte: now } },
      take: BATCH_LIMIT,
      include: { booking: { include: { business: true, staff: true, service: true } } },
      orderBy: { scheduledFor: 'asc' },
    });

    let processed = 0;
    for (const reminder of due) {
      // Idempotent guard: re-read status before sending
      const fresh = await prisma.bookingReminder.findUnique({
        where: { id: reminder.id },
        select: { status: true },
      });
      if (!fresh || fresh.status !== 'PENDING') continue;

      const { booking } = reminder;
      const business = booking.business;
      const tz = business.timezone || 'Asia/Kolkata';
      const dateStr = timeService.toDateStr(booking.date, tz);

      let sent = false;
      try {
        await notificationService.sendReminder(
          {
            ...booking,
            dateDisplay: dateStr,
            timezone: tz,
          },
          business,
          reminder.channel as 'email' | 'whatsapp'
        );
        sent = true;
      } catch (e: any) {
        await prisma.bookingReminder.update({
          where: { id: reminder.id },
          data: {
            attempts: { increment: 1 },
            status: reminder.attempts + 1 >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
            lastError: (e?.message || 'send failed').slice(0, 500),
          },
        });
        continue;
      }

      await prisma.bookingReminder.update({
        where: { id: reminder.id },
        data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 } },
      });
      processed++;
    }
    return processed;
  }
}

export const reminderService = new ReminderService();
