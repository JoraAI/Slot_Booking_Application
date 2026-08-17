import prisma from '../lib/prisma';
import { availabilityService } from './AvailabilityService';
import { pricingService } from './PricingService';
import { timeService } from './TimeService';
import { businessResolver } from './BusinessResolver';
import { bookingManagementService } from './BookingManagementService';
import { customerService } from './CustomerService';

const BOOKING_SOURCES = ['QR', 'EMBED', 'WIDGET', 'DIRECT'] as const;
type BookingSourceValue = typeof BOOKING_SOURCES[number];

/**
 * Day-scoped advisory-lock keys shared by every capacity-consuming slot insert
 * (Batch 3A): unpaid/free/recurring booking creates AND payment-hold creation
 * serialize on the SAME keys, widened from the per-startTime key so that
 * overlapping-start creates (same service, starts within duration+buffer) and
 * shared-staff creates (one staff member across several services) cannot both
 * pass their availability re-checks.
 *
 * - POOLED services lock the service-day: `slot:{businessId}:{serviceId}:{date}`.
 * - STAFF_BASED services lock the staff-day: `staff:{businessId}:{staffId}:{date}`.
 */
export const serviceDayLockKey = (businessId: string, serviceId: string, date: string): string =>
  `slot:${businessId}:${serviceId}:${date}`;
export const staffDayLockKey = (businessId: string, staffId: string, date: string): string =>
  `staff:${businessId}:${staffId}:${date}`;

/** Normalize a source value; unknown/missing becomes DIRECT. */
export function normalizeSource(raw?: unknown): BookingSourceValue {
  const value = typeof raw === 'string' ? raw.toUpperCase() : '';
  if ((BOOKING_SOURCES as readonly string[]).includes(value)) return value as BookingSourceValue;
  return 'DIRECT';
}

class BookingService {
  /**
   * Create a service-aware booking. The server derives duration, buffer,
   * end time, occupied end, pricing, and source. Browser-supplied values for
   * these fields are ignored.
   */
  async createBooking(
    identifier: string,
    data: {
      date: string;
      startTime: string;
      serviceId: string;
      staffId?: string | null;
      customerName: string;
      customerPhone: string;
      customerEmail?: string | null;
      formData?: any;
      isRecurring?: boolean;
      recurringRule?: string | null;
      recurringGroupId?: string | null;
      paymentStatus?: string;
      paymentAmount?: number;
      razorpayOrderId?: string;
      razorpayPaymentId?: string;
      source?: string;
    },
    opts?: { client?: any; excludeAttemptId?: string; lock?: boolean }
  ): Promise<any> {
    // Batch 3A: every standalone (unpaid/free/recurring) capacity-consuming
    // insert runs inside one DB transaction that acquires a day-scoped
    // resource lock (service-day for POOLED, staff-day for STAFF_BASED) and
    // re-checks availability inside the lock before inserting — a losing
    // request fails with a clean conflict and no partial write. The payment
    // verify path passes `client` without `lock` (its hold is the reserved
    // capacity and consume-once guards it).
    if (!opts?.client) {
      return prisma.$transaction((tx) =>
        this.createBooking(identifier, { ...data }, { ...opts, client: tx, lock: true })
      );
    }

    const db = opts?.client ?? prisma;
    const business = await businessResolver.resolveOrThrow(identifier, db);
    const tz = business.timezone || 'Asia/Kolkata';

    const service = await db.service.findFirst({
      where: { id: data.serviceId, businessId: business.id, isActive: true },
      include: { staff: true, workingHours: true },
    });
    if (!service) throw new Error('Service not found or inactive');

    if (service.resourceMode !== 'STAFF_BASED') {
      data.staffId = undefined;
    }

    // Day-scoped resource lock (shared with the payment-hold path).
    if (opts?.lock) {
      if (service.resourceMode === 'STAFF_BASED') {
        // Auto-assign: a first availability pass resolves which staff member to
        // lock; the authoritative re-check below runs under the lock.
        if (!data.staffId) {
          const probe = await availabilityService.computeAvailability(business, service, data.date, undefined, { client: db });
          const probeSlot = probe.slots.find((s) => s.startTime === data.startTime);
          if (!probeSlot) throw new Error('Slot is no longer available');
          data.staffId = probeSlot.eligibleStaffIds[0] || null;
          if (!data.staffId) throw new Error('No assigned staff member is available for this slot');
        }
        await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${staffDayLockKey(business.id, data.staffId, data.date)}, 0))`;
      } else {
        await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${serviceDayLockKey(business.id, service.id, data.date)}, 0))`;
      }
    }

    // Server-side end time from the booked duration (buffer affects occupancy, not visible end)
    const [startH, startM] = data.startTime.split(':').map(Number);
    const endMin = startH * 60 + startM + service.durationMinutes;
    const endTime = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;

    // Pricing evaluated at booking time in the business timezone
    const pricing = pricingService.computePricing(service, timeService.toUtc(tz, data.date, data.startTime));

    // Re-check availability immediately before insertion. When creating from a
    // payment hold (verify path), the hold itself is excluded from occupancy so
    // it acts as the reserved capacity rather than a self-block.
    const availability = await availabilityService.computeAvailability(
      business,
      service,
      data.date,
      data.staffId || undefined,
      { client: db, excludeAttemptId: opts?.excludeAttemptId }
    );
    const slot = availability.slots.find((s) => s.startTime === data.startTime);
    if (!slot) {
      throw new Error('Slot is no longer available');
    }
    if (service.resourceMode === 'STAFF_BASED') {
      if (data.staffId && !slot.eligibleStaffIds.includes(data.staffId)) {
        throw new Error('Selected staff member is no longer available for this slot');
      }
      // No preference means "Any Available": assign one of the staff members
      // proven available by the authoritative engine.
      data.staffId = data.staffId || slot.eligibleStaffIds[0];
      if (!data.staffId) throw new Error('No assigned staff member is available for this slot');
    }

    const bookingDate = timeService.toUtc(tz, data.date, data.startTime);
    // Store the business-local date at UTC midnight so date-range queries are stable
    const dateOnly = timeService.dateToUtcMidnight(data.date);
    void bookingDate;

    const source = normalizeSource(data.source);

    // Every new booking gets a cryptographically random management token.
    // Only the SHA-256 hash is stored; the plaintext is returned once here.
    const { token: managementToken, hash: managementTokenHash } = bookingManagementService.generateToken();

    const booking = await db.booking.create({
      data: {
        businessId: business.id,
        serviceId: service.id,
        serviceNameSnapshot: service.name,
        durationMinutesSnapshot: service.durationMinutes,
        bufferMinutesSnapshot: service.bufferMinutes || 0,
        originalPrice: pricing.originalPrice,
        discountAmount: pricing.discountAmount,
        finalPrice: pricing.finalPrice,
        currency: 'INR',
        source,
        managementTokenHash,
        staffId: data.staffId || null,
        date: dateOnly,
        startTime: data.startTime,
        endTime,
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        customerEmail: data.customerEmail || null,
        formData: data.formData || {},
        seatIndex: 0,
        isRecurring: data.isRecurring || false,
        recurringRule: data.recurringRule || null,
        recurringGroupId: data.recurringGroupId || null,
        paymentStatus: data.paymentStatus || null,
        paymentAmount: data.paymentAmount || null,
        razorpayOrderId: data.razorpayOrderId || null,
        razorpayPaymentId: data.razorpayPaymentId || null,
      },
      include: { staff: true, business: true, service: true },
    });

    // Keep the owner's phonebook current in the same transaction as the
    // booking. A failed contact sync therefore cannot leave partial state.
    await customerService.syncFromBooking(business.id, {
      name: booking.customerName,
      phone: booking.customerPhone,
      email: booking.customerEmail,
    }, db);

    // Return the plaintext management token exactly once (creation only).
    return {
      ...booking,
      managementToken,
      managementUrl: bookingManagementService.managementUrl(business, booking.id, managementToken),
    };
  }

  async getBooking(identifier: string, bookingId: string) {
    const business = await businessResolver.resolveOrThrow(identifier);
    return prisma.booking.findFirst({
      where: { id: bookingId, businessId: business.id },
      include: { staff: true, service: true },
    });
  }

  async updateBooking(
    identifier: string,
    bookingId: string,
    data: {
      status?: string;
      customerName?: string;
      customerPhone?: string;
      customerEmail?: string;
      formData?: any;
      date?: string;
      startTime?: string;
      staffId?: string | null;
    },
    opts?: { client?: any; excludeBookingId?: string }
  ) {
    const db = opts?.client ?? prisma;
    const business = await businessResolver.resolveOrThrow(identifier, db);
    const tz = business.timezone || 'Asia/Kolkata';

    const booking = await db.booking.findFirst({
      where: { id: bookingId, businessId: business.id },
      include: { service: true },
    });
    if (!booking) throw new Error('Booking not found');

    // Reschedule: re-run the authoritative availability engine excluding this
    // booking so the moved appointment cannot overlap other bookings/holds.
    let resolvedStaffId: string | null | undefined;
    if ((data.date || data.startTime || data.staffId !== undefined) && booking.serviceId) {
      const service = booking.service || (await db.service.findFirst({
        where: { id: booking.serviceId, businessId: business.id, isActive: true },
        include: { staff: true, workingHours: true },
      }));
      if (!service) throw new Error('Service is no longer available for rescheduling');

      const newDate = data.date || timeService.toDateStr(booking.date, tz);
      const newTime = data.startTime || booking.startTime;
      const targetStaffId = data.staffId !== undefined ? data.staffId : (booking.staffId ?? undefined);

      const availability = await availabilityService.computeAvailability(
        business,
        service,
        newDate,
        service.resourceMode === 'STAFF_BASED' ? targetStaffId : undefined,
        { client: db, excludeBookingId: bookingId }
      );
      const slot = availability.slots.find((s) => s.startTime === newTime);
      if (!slot) {
        throw new Error('Slot is no longer available');
      }
      if (service.resourceMode === 'STAFF_BASED') {
        if (targetStaffId && !slot.eligibleStaffIds.includes(targetStaffId)) {
          throw new Error('Selected staff member is no longer available for this slot');
        }
        resolvedStaffId = targetStaffId || slot.eligibleStaffIds[0];
        if (!resolvedStaffId) throw new Error('No assigned staff member is available for this slot');
      } else {
        resolvedStaffId = null;
      }
    }

    const updateData: any = { ...data };
    delete updateData.id;
    if (resolvedStaffId !== undefined) updateData.staffId = resolvedStaffId;
    if (data.date) updateData.date = timeService.dateToUtcMidnight(data.date);
    if (data.status === 'CANCELLED') updateData.cancelledAt = new Date();

    // Reschedule uses the booking's own duration snapshot for the new end time
    if (data.startTime) {
      const duration = booking.durationMinutesSnapshot || 30;
      const [startH, startM] = data.startTime.split(':').map(Number);
      const endMin = startH * 60 + startM + duration;
      updateData.endTime = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
    }

    return db.booking.update({
      where: { id: bookingId },
      data: updateData,
      include: { staff: true, service: true },
    });
  }

  async cancelBooking(identifier: string, bookingId: string) {
    return this.updateBooking(identifier, bookingId, { status: 'CANCELLED' });
  }

  async getOwnerBookings(businessId: string, filters?: {
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    staffId?: string;
    serviceId?: string;
    page?: number | string;
    limit?: number | string;
  }) {
    // Query-string params arrive as strings; Prisma `skip`/`take` require Int.
    const page = Math.max(1, Number(filters?.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(filters?.limit) || 50));
    const skip = (page - 1) * limit;

    const where: any = { businessId };
    if (filters?.status) where.status = filters.status;
    if (filters?.staffId) where.staffId = filters.staffId;
    if (filters?.serviceId) where.serviceId = filters.serviceId;
    if (filters?.dateFrom || filters?.dateTo) {
      where.date = {};
      if (filters.dateFrom) where.date.gte = new Date(filters.dateFrom + 'T00:00:00Z');
      if (filters.dateTo) where.date.lte = new Date(filters.dateTo + 'T23:59:59Z');
    }

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: { staff: true, service: true },
        orderBy: { date: 'desc' },
        skip,
        take: limit,
      }),
      prisma.booking.count({ where }),
    ]);

    return { bookings, total, page, totalPages: Math.ceil(total / limit) };
  }

  async updateBookingStatus(businessId: string, bookingId: string, status: string) {
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, businessId },
    });
    if (!booking) {
      const err: any = new Error('Booking not found');
      err.status = 404;
      throw err;
    }

    return prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: status as any,
        ...(status === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
      },
      include: { staff: true, business: true, service: true },
    });
  }
}

export const bookingService = new BookingService();
export default bookingService;
