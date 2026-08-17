import prisma from '../lib/prisma';
import { timeService } from './TimeService';

interface WorkingPeriod {
  openMin: number;
  closeMin: number;
}

interface ServiceLike {
  id: string;
  businessId: string;
  durationMinutes: number;
  bufferMinutes: number;
  resourceMode: 'STAFF_BASED' | 'POOLED';
  capacity: number;
}

interface BusinessLike {
  id: string;
  timezone: string;
  slotGranularityMinutes: number;
  bookingWindowDays: number;
  minBookingNoticeHours?: number | null;
}

interface OccupancyEntry {
  startMin: number;
  occupiedEndMin: number;
  staffId: string | null;
  serviceId: string | null;
  /** true when this entry comes from a PaymentAttempt capacity hold */
  isHold?: boolean;
}

interface DayOccupancy {
  entries: OccupancyEntry[];
  blocked: {
    startMin: number;
    endMin: number;
    staffId: string | null;
  }[];
}

export interface AvailabilityQueryOptions {
  /** Transaction/global client to query with (single-implementation reuse) */
  client?: any;
  /** Exclude one PaymentAttempt hold from occupancy (used at verify time) */
  excludeAttemptId?: string;
  /** Exclude one Booking from occupancy (used when rescheduling it) */
  excludeBookingId?: string;
  /** Suppress next-available computation (used inside the bounded search) */
  suppressNextAvailable?: boolean;
}

const ACTIVE_HOLD_STATUSES = ['INITIATING', 'PENDING'] as const;

export interface AvailabilitySlot {
  startTime: string;
  endTime: string;
  eligibleStaffIds: string[];
  availableCapacity: number;
}

export interface AvailabilityResult {
  date: string;
  serviceId: string;
  durationMinutes: number;
  bufferMinutes: number;
  timezone: string;
  slots: AvailabilitySlot[];
  nextAvailable: string | null;
}

const MINUTES = (hhmm: string) => {
  const [hRaw, mRaw] = hhmm.split(':').map(Number);
  const h = hRaw === 24 ? 0 : hRaw;
  const m = mRaw || 0;
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};
const HHMM = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

class AvailabilityService {
  /**
   * New service-aware availability.
   * Resolves business by public code or legacy slug.
   */
  async getAvailability(
    identifier: string,
    dateStr: string,
    serviceId: string,
    staffId?: string
  ): Promise<AvailabilityResult> {
    const business = await prisma.business.findFirst({
      where: { OR: [{ publicCode: identifier }, { slug: identifier }] },
    });
    if (!business) {
      const err: any = new Error('Business not found');
      err.status = 404;
      throw err;
    }

    const service = await prisma.service.findFirst({
      where: { id: serviceId, businessId: business.id, isActive: true },
      include: { workingHours: true },
    });
    if (!service) {
      const err: any = new Error('Service not found');
      err.status = 404;
      throw err;
    }

    return this.computeAvailability(business as BusinessLike, service as ServiceLike, dateStr, staffId);
  }

  /**
   * Compute slots for one business-local date using the authoritative engine.
   * Active, unexpired PaymentAttempt holds consume capacity exactly like
   * CONFIRMED bookings (staff intervals for STAFF_BASED, pool units for POOLED).
   * When the day yields no slots, fills `nextAvailable` via the bounded search.
   */
  async computeAvailability(
    business: BusinessLike,
    service: ServiceLike,
    dateStr: string,
    staffId?: string,
    opts?: AvailabilityQueryOptions
  ): Promise<AvailabilityResult> {
    const result = await this.computeAvailabilityCore(business, service, dateStr, staffId, opts);
    if (result.slots.length === 0 && !opts?.suppressNextAvailable) {
      result.nextAvailable = await this.findNextAvailable(business, service, dateStr, opts);
    }
    return result;
  }

  private async computeAvailabilityCore(
    business: BusinessLike,
    service: ServiceLike,
    dateStr: string,
    staffId?: string,
    opts?: AvailabilityQueryOptions
  ): Promise<AvailabilityResult> {
    const db = opts?.client ?? prisma;
    const tz = business.timezone || 'Asia/Kolkata';
    const daysOut = timeService.daysFromToday(tz, dateStr);
    if (daysOut < 0 || daysOut > business.bookingWindowDays) {
      return { date: dateStr, serviceId: service.id, durationMinutes: service.durationMinutes, bufferMinutes: service.bufferMinutes, timezone: tz, slots: [], nextAvailable: null };
    }

    const dayOfWeek = timeService.dayOfWeek(dateStr);
    const granularity = business.slotGranularityMinutes || 15;
    const duration = service.durationMinutes;
    const buffer = service.bufferMinutes || 0;

    // Effective periods for the day
    const businessHours = await db.workingHour.findFirst({
      where: { businessId: business.id, dayOfWeek, isOpen: true },
    });
    if (!businessHours) {
      return { date: dateStr, serviceId: service.id, durationMinutes: duration, bufferMinutes: buffer, timezone: tz, slots: [], nextAvailable: null };
    }

    let periods: WorkingPeriod[] = [
      { openMin: MINUTES(businessHours.openTime), closeMin: MINUTES(businessHours.closeTime) },
    ];

    // Intersect with service-specific hours when configured
    const serviceHours = await db.serviceWorkingHour.findFirst({
      where: { businessId: business.id, serviceId: service.id, dayOfWeek },
    });
    if (serviceHours) {
      if (!serviceHours.isOpen) {
        return { date: dateStr, serviceId: service.id, durationMinutes: duration, bufferMinutes: buffer, timezone: tz, slots: [], nextAvailable: null };
      }
      periods = this.intersect(periods, { openMin: MINUTES(serviceHours.openTime), closeMin: MINUTES(serviceHours.closeTime) });
      if (periods.length === 0) {
        return { date: dateStr, serviceId: service.id, durationMinutes: duration, bufferMinutes: buffer, timezone: tz, slots: [], nextAvailable: null };
      }
    }

    // Occupancy for the day (bookings + blocked slots + active payment holds)
    const occupancy = await this.getDayOccupancy(business.id, dateStr, opts);

    // Eligible staff for STAFF_BASED
    let eligibleStaff: { id: string }[] = [];
    if (service.resourceMode === 'STAFF_BASED') {
      const assignments = await db.staffService.findMany({
        where: { serviceId: service.id, businessId: business.id, staff: { isActive: true } },
        select: { staffId: true },
      });
      eligibleStaff = assignments.map((a: any) => ({ id: a.staffId }));
      if (staffId) {
        if (!eligibleStaff.some((s) => s.id === staffId)) {
          throw new Error('Staff member is not eligible for this service');
        }
        eligibleStaff = [{ id: staffId }];
      }
      if (eligibleStaff.length === 0) {
        return { date: dateStr, serviceId: service.id, durationMinutes: duration, bufferMinutes: buffer, timezone: tz, slots: [], nextAvailable: null };
      }
    } else {
      // POOLED ignores staff
      staffId = undefined;
    }

    const candidates = this.generateCandidates(periods, granularity, duration, buffer);

    const slots: AvailabilitySlot[] = [];
    for (const candidate of candidates) {
      if (this.isTooSoon(business, tz, dateStr, candidate)) continue;

      const occupiedEnd = candidate + duration + buffer;
      if (service.resourceMode === 'STAFF_BASED') {
        const availableStaff: string[] = [];
        for (const staff of eligibleStaff) {
          if (await this.staffAvailableAt(business, staff.id, candidate, occupiedEnd, service, occupancy, dateStr, dayOfWeek, periods, db)) {
            availableStaff.push(staff.id);
          }
        }
        if (availableStaff.length > 0) {
          slots.push({
            startTime: HHMM(candidate),
            endTime: HHMM(candidate + duration),
            eligibleStaffIds: availableStaff,
            availableCapacity: availableStaff.length,
          });
        }
      } else {
        // POOLED: capacity is per-service. Legacy bookings/holds with a NULL
        // serviceId (pre-catalog rows) still consume pool capacity.
        const overlapping = occupancy.entries.filter(
          (e) =>
            (e.serviceId === null || e.serviceId === service.id) &&
            candidate < e.occupiedEndMin &&
            e.startMin < occupiedEnd
        ).length;
        const isBlocked = occupancy.blocked.some(
          (bl) => bl.staffId === null && candidate < bl.endMin && bl.startMin < occupiedEnd
        );
        if (!isBlocked && overlapping < (service.capacity || 1)) {
          slots.push({
            startTime: HHMM(candidate),
            endTime: HHMM(candidate + duration),
            eligibleStaffIds: [],
            availableCapacity: (service.capacity || 1) - overlapping,
          });
        }
      }
    }

    return {
      date: dateStr,
      serviceId: service.id,
      durationMinutes: duration,
      bufferMinutes: buffer,
      timezone: tz,
      slots,
      nextAvailable: null,
    };
  }

  /**
   * Bounded next-available search over the booking window.
   * `opts.suppressNextAvailable` prevents recursive next-available lookups.
   */
  async findNextAvailable(
    business: BusinessLike,
    service: ServiceLike,
    fromDateStr: string,
    opts?: AvailabilityQueryOptions
  ): Promise<string | null> {
    const tz = business.timezone || 'Asia/Kolkata';
    const start = timeService.daysFromToday(tz, fromDateStr);
    const bound = Math.min(business.bookingWindowDays, 30);
    const [y, m, d] = fromDateStr.split('-').map(Number);
    const fromMs = Date.UTC(y, m - 1, d);
    for (let offset = Math.max(0, start); offset <= bound; offset++) {
      const dateStr = timeService.toDateStr(new Date(fromMs + offset * 86400000), tz);
      const result = await this.computeAvailability(business, service, dateStr, undefined, {
        client: opts?.client,
        suppressNextAvailable: true,
      });
      if (result.slots.length > 0) return dateStr;
    }
    return null;
  }

  private async staffAvailableAt(
    business: BusinessLike,
    staffId: string,
    candidate: number,
    occupiedEnd: number,
    service: ServiceLike,
    occupancy: DayOccupancy,
    dateStr: string,
    dayOfWeek: number,
    businessPeriods: WorkingPeriod[],
    db: any = prisma
  ): Promise<boolean> {
    // Intersect staff hours when configured
    const staffHours = await db.staffWorkingHour.findFirst({
      where: { businessId: business.id, staffId, dayOfWeek },
    });
    if (staffHours) {
      if (!staffHours.isOpen) return false;
      const sp = this.intersect(businessPeriods, { openMin: MINUTES(staffHours.openTime), closeMin: MINUTES(staffHours.closeTime) });
      if (sp.length === 0) return false;
      const within = sp.some((p) => candidate >= p.openMin && candidate + service.durationMinutes + service.bufferMinutes <= p.closeMin);
      if (!within) return false;
    }

    // Staff-specific and global blocks
    const blocked = occupancy.blocked.filter((b) => b.staffId === null || b.staffId === staffId);
    if (blocked.some((bl) => candidate < bl.endMin && bl.startMin < occupiedEnd)) return false;

    // Overlapping bookings AND active capacity holds for this staff
    // (a staff member is capacity one)
    const overlapping = occupancy.entries.filter(
      (e) => e.staffId === staffId && candidate < e.occupiedEndMin && e.startMin < occupiedEnd
    );
    return overlapping.length === 0;
  }

  private async getDayOccupancy(
    businessId: string,
    dateStr: string,
    opts?: AvailabilityQueryOptions
  ): Promise<DayOccupancy> {
    const db = opts?.client ?? prisma;
    const { gte: startOfDay, lte: endOfDay } = timeService.dayRangeUtc(dateStr);

    const [bookings, blockedSlots, holds] = await Promise.all([
      db.booking.findMany({
        where: {
          businessId,
          date: { gte: startOfDay, lte: endOfDay },
          status: 'CONFIRMED',
          ...(opts?.excludeBookingId ? { id: { not: opts.excludeBookingId } } : {}),
        },
        select: {
          startTime: true,
          endTime: true,
          staffId: true,
          serviceId: true,
          durationMinutesSnapshot: true,
          bufferMinutesSnapshot: true,
        },
      }),
      db.blockedSlot.findMany({
        where: { businessId, date: { gte: startOfDay, lte: endOfDay } },
        select: { startTime: true, endTime: true, staffId: true },
      }),
      db.paymentAttempt.findMany({
        where: {
          businessId,
          date: { gte: startOfDay, lte: endOfDay },
          status: { in: [...ACTIVE_HOLD_STATUSES] },
          holdExpiresAt: { gt: new Date() },
          ...(opts?.excludeAttemptId ? { id: { not: opts.excludeAttemptId } } : {}),
        },
        select: {
          startTime: true,
          occupiedEndTime: true,
          staffId: true,
          serviceId: true,
        },
      }),
    ]);

    return {
      entries: [
        ...bookings.map((b: any) => {
          const startMin = MINUTES(b.startTime);
          const visibleEnd = MINUTES(b.endTime);
          // New bookings store buffer snapshots; legacy rows use visible end only
          const occupiedEndMin = (b.bufferMinutesSnapshot ?? 0) > 0
            ? visibleEnd + (b.bufferMinutesSnapshot || 0)
            : visibleEnd;
          return { startMin, occupiedEndMin, staffId: b.staffId, serviceId: b.serviceId, isHold: false };
        }),
        ...holds.map((h: any) => ({
          startMin: MINUTES(h.startTime),
          occupiedEndMin: MINUTES(h.occupiedEndTime),
          staffId: h.staffId,
          serviceId: h.serviceId,
          isHold: true,
        })),
      ],
      blocked: blockedSlots.map((b: any) => ({
        startMin: MINUTES(b.startTime),
        endMin: MINUTES(b.endTime),
        staffId: b.staffId,
      })),
    };
  }

  private generateCandidates(periods: WorkingPeriod[], granularity: number, duration: number, buffer: number): number[] {
    const candidates: number[] = [];
    for (const period of periods) {
      let start = period.openMin;
      while (start + duration + buffer <= period.closeMin) {
        candidates.push(start);
        start += granularity;
      }
    }
    return candidates;
  }

  private intersect(base: WorkingPeriod[], other: WorkingPeriod): WorkingPeriod[] {
    const result: WorkingPeriod[] = [];
    for (const b of base) {
      const open = Math.max(b.openMin, other.openMin);
      const close = Math.min(b.closeMin, other.closeMin);
      if (open < close) result.push({ openMin: open, closeMin: close });
    }
    return result;
  }

  /** Slots at or before now + minBookingNoticeHours are not offered. */
  private isTooSoon(business: BusinessLike, tz: string, dateStr: string, startMin: number): boolean {
    const hours = Math.max(0, Number(business.minBookingNoticeHours) || 0);
    const earliest = new Date(Date.now() + hours * 60 * 60 * 1000);
    const earliestDate = timeService.toDateStr(earliest, tz);
    if (dateStr < earliestDate) return true;
    if (dateStr > earliestDate) return false;
    return startMin <= MINUTES(timeService.toTimeStr(earliest, tz));
  }

  /**
   * Legacy fallback for old flows/historical records without a service.
   * Duration and capacity are fixed constants (per-service fields are authoritative).
   */
  async getLegacyAvailability(slug: string, dateStr: string, staffId?: string) {
    const business = await prisma.business.findUnique({
      where: { slug },
      include: { workingHours: true },
    });
    if (!business) {
      const err: any = new Error('Business not found');
      err.status = 404;
      throw err;
    }

    const tz = business.timezone || 'Asia/Kolkata';
    const daysOut = timeService.daysFromToday(tz, dateStr);
    if (daysOut < 0 || daysOut > business.bookingWindowDays) {
      return { slots: [], business };
    }

    const dayOfWeek = timeService.dayOfWeek(dateStr);
    const workingHour = business.workingHours.find((wh) => wh.dayOfWeek === dayOfWeek && wh.isOpen);
    if (!workingHour) return { slots: [], business };

    const duration = 30;
    const legacyCapacity = 1;
    const slots = this.generateCandidates(
      [{ openMin: MINUTES(workingHour.openTime), closeMin: MINUTES(workingHour.closeTime) }],
      duration,
      duration,
      0
    )
      .filter((c) => !this.isTooSoon(business, tz, dateStr, c))
      .map((c) => ({ time: HHMM(c), endTime: HHMM(c + duration) }));

    const { gte: startOfDay, lte: endOfDay } = timeService.dayRangeUtc(dateStr);
    const [bookings, blockedSlots] = await Promise.all([
      prisma.booking.findMany({
        where: {
          businessId: business.id,
          date: { gte: startOfDay, lte: endOfDay },
          status: 'CONFIRMED',
          ...(staffId ? { staffId } : {}),
        },
      }),
      prisma.blockedSlot.findMany({
        where: { businessId: business.id, date: { gte: startOfDay, lte: endOfDay }, ...(staffId ? { staffId } : {}) },
      }),
    ]);

    const enriched = slots.map((slot) => {
      const bookedCount = bookings.filter((b) => b.startTime === slot.time).length;
      const isBlocked = blockedSlots.some((bs) => bs.startTime === slot.time);
      const availableSeats = legacyCapacity - bookedCount;
      return {
        time: slot.time,
        endTime: slot.endTime,
        isAvailable: !isBlocked && availableSeats > 0,
        ...(business.showAvailableCount ? { availableSeats } : {}),
        isBlocked,
      };
    });

    return { slots: enriched, business };
  }
}

export const availabilityService = new AvailabilityService();
export default availabilityService;
