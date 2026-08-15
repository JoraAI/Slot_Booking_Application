import prisma from '../lib/prisma';
import { notificationService } from './NotificationService';
import { normalizeSource } from './BookingService';
import { timeService } from './TimeService';
import { availabilityService } from './AvailabilityService';

const NOTIFIED_HOLD_MINUTES = 30;
const BATCH_LIMIT = 50;

/**
 * Waitlist handling. Expiry is DURABLE and DB-backed: a notified entry carries
 * `expiresAt` and is expired by the authenticated cron job
 * (POST /api/internal/jobs/process-waitlist-expirations), not by an in-process
 * timer that dies with the process.
 */
class WaitlistService {
  async addToWaitlist(identifier: string, data: {
    date: string;
    startTime: string;
    customerName: string;
    customerPhone: string;
    customerEmail?: string | null;
    staffId?: string | null;
    serviceId?: string | null;
    durationMinutes?: number;
    source?: string | null;
    formData?: any;
  }) {
    const business = await prisma.business.findFirst({
      where: { OR: [{ publicCode: identifier }, { slug: identifier }] },
    });
    if (!business) throw new Error('Business not found');
    if (!business.enableWaitlist) throw new Error('Waitlist feature not enabled');

    // Validate service belongs to this business when provided
    let durationSnapshot: number | undefined;
    if (data.serviceId) {
      const service = await prisma.service.findFirst({
        where: { id: data.serviceId, businessId: business.id },
      });
      if (!service) throw new Error('Service not found');
      durationSnapshot = service.durationMinutes;
    }
    durationSnapshot = durationSnapshot ?? data.durationMinutes;

    const entry = await prisma.waitlistEntry.create({
      data: {
        businessId: business.id,
        date: timeService.dateToUtcMidnight(data.date),
        startTime: data.startTime,
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        customerEmail: data.customerEmail || null,
        staffId: data.staffId || null,
        serviceId: data.serviceId || null,
        durationMinutesSnapshot: durationSnapshot || null,
        source: normalizeSource(data.source),
        formData: data.formData || {},
      },
    });

    await notificationService.sendWaitlistJoined(entry, business);

    return entry;
  }

  /**
   * Notify the next eligible waiting entry (optionally scoped to a
   * service/staff). The notified entry gets a 30-minute, DB-backed expiresAt.
   */
  async notifyNext(
    businessId: string,
    date: string,
    startTime: string,
    opts?: { serviceId?: string | null; staffId?: string | null }
  ): Promise<void> {
    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) return;

    const { gte: startOfDay, lte: endOfDay } = timeService.dayRangeUtc(date);

    const nextEntry = await prisma.waitlistEntry.findFirst({
      where: {
        businessId,
        date: { gte: startOfDay, lte: endOfDay },
        startTime,
        notified: false,
        expired: false,
        ...(opts?.serviceId ? { serviceId: opts.serviceId } : {}),
        ...(opts?.staffId ? { staffId: opts.staffId } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!nextEntry) return;

    const bookingLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/b/${business.publicCode}?date=${date}&time=${startTime}`;

    await prisma.waitlistEntry.update({
      where: { id: nextEntry.id },
      data: {
        notified: true,
        notifiedAt: new Date(),
        expiresAt: new Date(Date.now() + NOTIFIED_HOLD_MINUTES * 60000),
      },
    });

    await notificationService.sendWaitlistOpened(nextEntry, business, bookingLink);
  }

  /**
   * Durable cron processor: expire notified-but-stale entries and cascade to the
   * next eligible entry ONLY if the slot is still authoritatively available for
   * that service/staff. Idempotent by status guard.
   */
  async processExpired(now: Date = new Date()): Promise<number> {
    const due = await prisma.waitlistEntry.findMany({
      where: { notified: true, expired: false, expiresAt: { lte: now } },
      take: BATCH_LIMIT,
    });

    let processed = 0;
    for (const entry of due) {
      // Idempotent guard: re-read state before mutating
      const fresh = await prisma.waitlistEntry.findUnique({
        where: { id: entry.id },
        select: { notified: true, expired: true, expiresAt: true },
      });
      if (!fresh || !fresh.notified || fresh.expired) continue;
      if (fresh.expiresAt === null || fresh.expiresAt > now) continue;

      await prisma.waitlistEntry.update({ where: { id: entry.id }, data: { expired: true } });
      processed++;

      const business = await prisma.business.findUnique({ where: { id: entry.businessId } });
      if (business) {
        await notificationService.sendWaitlistExpired(entry, business);
        const dateStr = timeService.toDateStr(entry.date, business.timezone || 'Asia/Kolkata');
        await this.notifyNextIfAvailable(business, dateStr, entry.startTime, entry.serviceId, entry.staffId);
      }
    }
    return processed;
  }

  /** Cascade only when the slot is still available for that service/staff. */
  private async notifyNextIfAvailable(
    business: any,
    date: string,
    startTime: string,
    serviceId: string | null,
    staffId: string | null
  ): Promise<void> {
    if (serviceId) {
      const service = await prisma.service.findFirst({
        where: { id: serviceId, businessId: business.id, isActive: true },
      });
      if (!service) return;
      const availability = await availabilityService.computeAvailability(
        business,
        service,
        date,
        service.resourceMode === 'STAFF_BASED' ? (staffId || undefined) : undefined
      );
      const slot = availability.slots.find((s) => s.startTime === startTime);
      if (!slot) return;
      if (service.resourceMode === 'STAFF_BASED' && staffId && !slot.eligibleStaffIds.includes(staffId)) return;
    } else {
      // Legacy entry without a service: authoritative flat slot check
      const legacy = await availabilityService.getLegacyAvailability(business.slug, date, staffId || undefined);
      const slot = legacy.slots.find((s) => s.time === startTime);
      if (!slot || !slot.isAvailable) return;
    }
    await this.notifyNext(business.id, date, startTime, { serviceId, staffId });
  }

  async getWaitlistForSlot(businessId: string, date: string, startTime: string) {
    const { gte: startOfDay, lte: endOfDay } = timeService.dayRangeUtc(date);

    return prisma.waitlistEntry.findMany({
      where: {
        businessId,
        date: { gte: startOfDay, lte: endOfDay },
        startTime,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getWaitlistForBusiness(businessId: string, filters?: {
    date?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters?.page || 1;
    const limit = filters?.limit || 50;

    const where: any = { businessId };
    if (filters?.date) {
      const { gte: startOfDay, lte: endOfDay } = timeService.dayRangeUtc(filters.date);
      where.date = { gte: startOfDay, lte: endOfDay };
    }
    if (filters?.status === 'waiting') {
      where.notified = false;
      where.expired = false;
    } else if (filters?.status === 'notified') {
      where.notified = true;
      where.expired = false;
    } else if (filters?.status === 'expired') {
      where.expired = true;
    }

    const [entries, total] = await Promise.all([
      prisma.waitlistEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.waitlistEntry.count({ where }),
    ]);

    return { entries, total, page, totalPages: Math.ceil(total / limit) };
  }

  async removeEntry(businessId: string, entryId: string) {
    const entry = await prisma.waitlistEntry.findFirst({
      where: { id: entryId, businessId },
    });
    if (!entry) {
      const err: any = new Error('Waitlist entry not found');
      err.status = 404;
      throw err;
    }
    return prisma.waitlistEntry.delete({ where: { id: entryId } });
  }

  async manuallyNotify(businessId: string, entryId: string) {
    const entry = await prisma.waitlistEntry.findFirst({
      where: { id: entryId, businessId },
    });
    if (!entry) throw new Error('Waitlist entry not found');

    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new Error('Business not found');

    const dateStr = timeService.toDateStr(entry.date, business.timezone || 'Asia/Kolkata');
    const bookingLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/b/${business.publicCode}?date=${dateStr}&time=${entry.startTime}`;

    await prisma.waitlistEntry.update({
      where: { id: entryId },
      data: {
        notified: true,
        notifiedAt: new Date(),
        expiresAt: new Date(Date.now() + NOTIFIED_HOLD_MINUTES * 60000),
      },
    });

    await notificationService.sendWaitlistOpened(entry, business, bookingLink);

    return entry;
  }
}

export const waitlistService = new WaitlistService();
