import { RRule } from 'rrule';
import prisma from '../lib/prisma';
import { bookingService } from './BookingService';
import { notificationService } from './NotificationService';
import { waitlistService } from './WaitlistService';
import { availabilityService } from './AvailabilityService';
import { timeService } from './TimeService';

class RecurringService {
  /**
   * Generate recurrence dates as BUSINESS-LOCAL date strings (YYYY-MM-DD).
   * The RRule dtstart is anchored at UTC midnight of the start date and each
   * occurrence is converted to the business timezone, so the result never
   * depends on the host timezone or toISOString date derivation.
   */
  generateDates(startDate: string, frequency: 'weekly' | 'biweekly' | 'monthly', count: number, tz: string): string[] {
    const [y, m, d] = startDate.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, d));

    const freqMap = {
      weekly: RRule.WEEKLY,
      biweekly: RRule.WEEKLY,
      monthly: RRule.MONTHLY,
    };

    const rule = new RRule({
      freq: freqMap[frequency],
      interval: frequency === 'biweekly' ? 2 : 1,
      count,
      dtstart: start,
    });

    return rule.all().map((dt) => timeService.toDateStr(dt, tz));
  }

  async createRecurringBooking(identifier: string, data: {
    startDate: string;
    startTime: string;
    serviceId: string;
    staffId?: string | null;
    customerName: string;
    customerPhone: string;
    customerEmail?: string | null;
    formData?: any;
    frequency: 'weekly' | 'biweekly' | 'monthly';
    count: number;
    skipDates?: string[];
    source?: string | null;
  }) {
    const business = await prisma.business.findFirst({
      where: { OR: [{ publicCode: identifier }, { slug: identifier }] },
    });
    if (!business) throw new Error('Business not found');
    if (!business.enableRecurring) throw new Error('Recurring feature not enabled');
    if (business.enablePayments && business.paymentMode !== 'none') {
      throw new Error('Recurring series are unavailable while online payment is required');
    }

    const service = await prisma.service.findFirst({
      where: { id: data.serviceId, businessId: business.id, isActive: true },
      include: { staff: true },
    });
    if (!service) throw new Error('Service not found or inactive');

    if (service.resourceMode === 'STAFF_BASED' && data.staffId) {
      const assigned = service.staff.some((s) => s.staffId === data.staffId);
      if (!assigned) throw new Error('Selected staff member is not assigned to this service');
    }

    const tz = business.timezone || 'Asia/Kolkata';
    const dates = this.generateDates(data.startDate, data.frequency, data.count, tz);
    const skipSet = new Set(data.skipDates || []);
    const recurringGroupId = `rec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const rruleStr = `FREQ=${data.frequency === 'biweekly' ? 'WEEKLY' : data.frequency.toUpperCase()};COUNT=${data.count}${data.frequency === 'biweekly' ? ';INTERVAL=2' : ''}`;

    const bookings: any[] = [];
    const conflicts: { date: string; reason: string }[] = [];

    // Each occurrence must pass service-aware availability. Conflicts are
    // reported instead of silently creating overlapping bookings.
    for (const dateStr of dates) {
      if (skipSet.has(dateStr)) continue;

      try {
        const availability = await availabilityService.computeAvailability(
          business,
          service,
          dateStr,
          service.resourceMode === 'STAFF_BASED' ? (data.staffId ?? undefined) : undefined
        );
        const slot = availability.slots.find((s) => s.startTime === data.startTime);
        if (!slot) {
          conflicts.push({ date: dateStr, reason: 'Slot unavailable' });
          continue;
        }
        if (service.resourceMode === 'STAFF_BASED' && data.staffId) {
          if (!slot.eligibleStaffIds.includes(data.staffId)) {
            conflicts.push({ date: dateStr, reason: 'Staff unavailable' });
            continue;
          }
        }

        const booking = await bookingService.createBooking(identifier, {
          date: dateStr,
          startTime: data.startTime,
          serviceId: service.id,
          staffId: service.resourceMode === 'STAFF_BASED' ? data.staffId : null,
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          customerEmail: data.customerEmail || null,
          formData: data.formData || {},
          isRecurring: true,
          recurringRule: rruleStr,
          recurringGroupId,
          source: data.source || undefined,
        });

        bookings.push(booking);
      } catch (e: any) {
        conflicts.push({ date: dateStr, reason: e.message || 'Unavailable' });
      }
    }

    // Send recurring confirmation notification
    if (bookings.length > 0) {
      await notificationService.sendRecurringSeriesConfirmation(
        bookings.map(b => ({ ...b, date: b.date })),
        business
      );
    }

    return { bookings, recurringGroupId, conflicts };
  }

  async cancelSeries(businessId: string, recurringGroupId: string, cancelFutureOnly: boolean = true) {
    const where: any = {
      businessId,
      recurringGroupId,
      status: 'CONFIRMED',
    };

    if (cancelFutureOnly) {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      where.date = { gte: now };
    }

    const bookings = await prisma.booking.findMany({ where });

    await prisma.booking.updateMany({
      where,
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    const business = await prisma.business.findUnique({ where: { id: businessId } });

    // Notify
    if (business && bookings.length > 0) {
      await notificationService.sendRecurringSeriesCancellation(bookings, business);

      // Trigger waitlist notifications for each freed slot (business-local date)
      for (const booking of bookings) {
        if (business.enableWaitlist) {
          const dateStr = timeService.toDateStr(booking.date, business.timezone || 'Asia/Kolkata');
          await waitlistService.notifyNext(businessId, dateStr, booking.startTime, {
            serviceId: booking.serviceId,
            staffId: booking.staffId,
          });
        }
      }
    }

    return bookings.length;
  }

  async getSeriesBookings(businessId: string, recurringGroupId: string) {
    return prisma.booking.findMany({
      where: { businessId, recurringGroupId },
      orderBy: { date: 'asc' },
      include: { staff: true },
    });
  }
}

export const recurringService = new RecurringService();