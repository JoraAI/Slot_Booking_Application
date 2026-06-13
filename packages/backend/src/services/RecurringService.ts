import { RRule } from 'rrule';
import prisma from '../lib/prisma';
import { bookingService } from './BookingService';
import { notificationService } from './NotificationService';
import { waitlistService } from './WaitlistService';

class RecurringService {
  generateDates(startDate: string, frequency: 'weekly' | 'biweekly' | 'monthly', count: number): Date[] {
    const start = new Date(startDate);

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

    return rule.all();
  }

  async createRecurringBooking(slug: string, data: {
    startDate: string;
    startTime: string;
    staffId?: string;
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    formData?: any;
    frequency: 'weekly' | 'biweekly' | 'monthly';
    count: number;
    skipDates?: string[];
  }) {
    const business = await prisma.business.findUnique({ where: { slug } });
    if (!business) throw new Error('Business not found');
    if (!business.enableRecurring) throw new Error('Recurring feature not enabled');

    const dates = this.generateDates(data.startDate, data.frequency, data.count);
    const skipSet = new Set(data.skipDates || []);
    const recurringGroupId = `rec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const rruleStr = `FREQ=${data.frequency === 'biweekly' ? 'WEEKLY' : data.frequency.toUpperCase()};COUNT=${data.count}${data.frequency === 'biweekly' ? ';INTERVAL=2' : ''}`;

    const bookings: any[] = [];

    // Use transaction for atomic creation
    await prisma.$transaction(async (tx) => {
      for (const date of dates) {
        const dateStr = date.toISOString().split('T')[0];
        if (skipSet.has(dateStr)) continue;

        const [startH, startM] = data.startTime.split(':').map(Number);
        const endTimeMinutes = startH * 60 + startM + business.slotDurationMinutes;
        const endH = Math.floor(endTimeMinutes / 60);
        const endM = endTimeMinutes % 60;
        const endTime = `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;

        // Check availability for this date
        const startOfDay = new Date(dateStr);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(dateStr);
        endOfDay.setHours(23, 59, 59, 999);

        const existingBookings = await tx.booking.count({
          where: {
            businessId: business.id,
            date: { gte: startOfDay, lte: endOfDay },
            startTime: data.startTime,
            status: 'CONFIRMED',
            ...(data.staffId ? { staffId: data.staffId } : {}),
          },
        });

        const blockedSlots = await tx.blockedSlot.count({
          where: {
            businessId: business.id,
            date: { gte: startOfDay, lte: endOfDay },
            startTime: data.startTime,
            ...(data.staffId ? { staffId: data.staffId } : {}),
          },
        });

        if (blockedSlots > 0 || existingBookings >= business.parallelSeats) {
          throw new Error(`No availability on ${dateStr} at ${data.startTime}`);
        }

        const booking = await tx.booking.create({
          data: {
            businessId: business.id,
            staffId: data.staffId || null,
            date,
            startTime: data.startTime,
            endTime,
            customerName: data.customerName,
            customerPhone: data.customerPhone,
            customerEmail: data.customerEmail || null,
            formData: data.formData || {},
            seatIndex: 0,
            isRecurring: true,
            recurringRule: rruleStr,
            recurringGroupId,
          },
          include: { staff: true },
        });

        bookings.push(booking);
      }
    });

    // Send recurring confirmation notification
    if (bookings.length > 0) {
      await notificationService.sendRecurringSeriesConfirmation(
        bookings.map(b => ({ ...b, date: b.date })),
        business
      );
    }

    return { bookings, recurringGroupId };
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

      // Trigger waitlist notifications for each freed slot
      for (const booking of bookings) {
        const dateStr = new Date(booking.date).toISOString().split('T')[0];
        if (business.enableWaitlist) {
          await waitlistService.notifyNext(businessId, dateStr, booking.startTime);
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