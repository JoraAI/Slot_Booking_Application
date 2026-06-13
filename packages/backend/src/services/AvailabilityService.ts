import prisma from '../lib/prisma';

interface TimeSlot {
  time: string;
  endTime: string;
  isAvailable: boolean;
  availableSeats?: number;
  isBlocked: boolean;
  waitlistCount?: number;
}

class AvailabilityService {
  async getAvailability(slug: string, dateStr: string, staffId?: string): Promise<{
    slots: TimeSlot[];
    business: any;
  }> {
    const business = await prisma.business.findUnique({
      where: { slug },
      include: { workingHours: true },
    });

    if (!business) {
      throw new Error('Business not found');
    }

    const date = new Date(dateStr);
    const dayOfWeek = date.getUTCDay();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + business.bookingWindowDays);

    if (date < today || date > maxDate) {
      return { slots: [], business };
    }

    const workingHour = business.workingHours.find(wh => wh.dayOfWeek === dayOfWeek && wh.isOpen);
    if (!workingHour) {
      return { slots: [], business };
    }

    const slots = this.generateTimeSlots(
      workingHour.openTime,
      workingHour.closeTime,
      business.slotDurationMinutes
    );

    const startOfDay = new Date(dateStr);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(dateStr);
    endOfDay.setHours(23, 59, 59, 999);

    const bookings = await prisma.booking.findMany({
      where: {
        businessId: business.id,
        date: { gte: startOfDay, lte: endOfDay },
        status: { in: ['CONFIRMED'] },
        ...(staffId ? { staffId } : {}),
      },
    });

    const blockedSlots = await prisma.blockedSlot.findMany({
      where: {
        businessId: business.id,
        date: { gte: startOfDay, lte: endOfDay },
        ...(staffId ? { staffId } : {}),
      },
    });

    let waitlistEntries: any[] = [];
    if (business.enableWaitlist) {
      waitlistEntries = await prisma.waitlistEntry.findMany({
        where: {
          businessId: business.id,
          date: { gte: startOfDay, lte: endOfDay },
          expired: false,
          ...(staffId ? { staffId } : {}),
        },
      });
    }

    const enrichedSlots: TimeSlot[] = slots.map(slot => {
      const bookedCount = bookings.filter(
        b => b.startTime === slot.time && b.endTime === slot.endTime
      ).length;

      const isBlocked = blockedSlots.some(
        bs => bs.startTime === slot.time && bs.endTime === slot.endTime
      );

      const availableSeats = business.parallelSeats - bookedCount;
      const isAvailable = !isBlocked && availableSeats > 0;

      const waitlistCount = business.enableWaitlist
        ? waitlistEntries.filter(w => w.startTime === slot.time).length
        : undefined;

      return {
        time: slot.time,
        endTime: slot.endTime,
        isAvailable,
        ...(business.showAvailableCount ? { availableSeats } : {}),
        isBlocked,
        ...(waitlistCount !== undefined ? { waitlistCount } : {}),
      };
    });

    return { slots: enrichedSlots, business };
  }

  private generateTimeSlots(openTime: string, closeTime: string, duration: number): { time: string; endTime: string }[] {
    const slots: { time: string; endTime: string }[] = [];
    const [openH, openM] = openTime.split(':').map(Number);
    const [closeH, closeM] = closeTime.split(':').map(Number);

    let currentMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;

    while (currentMinutes + duration <= closeMinutes) {
      const hours = Math.floor(currentMinutes / 60);
      const minutes = currentMinutes % 60;
      const endTimeMinutes = currentMinutes + duration;
      const endHours = Math.floor(endTimeMinutes / 60);
      const endMinutes = endTimeMinutes % 60;

      slots.push({
        time: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`,
        endTime: `${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`,
      });

      currentMinutes += duration;
    }

    return slots;
  }
}

export const availabilityService = new AvailabilityService();