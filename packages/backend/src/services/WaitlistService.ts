import prisma from '../lib/prisma';
import { notificationService } from './NotificationService';

class WaitlistService {
  async addToWaitlist(slug: string, data: {
    date: string;
    startTime: string;
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    staffId?: string;
    formData?: any;
  }) {
    const business = await prisma.business.findUnique({ where: { slug } });
    if (!business) throw new Error('Business not found');
    if (!business.enableWaitlist) throw new Error('Waitlist feature not enabled');

    const entry = await prisma.waitlistEntry.create({
      data: {
        businessId: business.id,
        date: new Date(data.date),
        startTime: data.startTime,
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        customerEmail: data.customerEmail || null,
        staffId: data.staffId || null,
        formData: data.formData || {},
      },
    });

    await notificationService.sendWaitlistJoined(entry, business);

    return entry;
  }

  async notifyNext(businessId: string, date: string, startTime: string): Promise<void> {
    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) return;

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const nextEntry = await prisma.waitlistEntry.findFirst({
      where: {
        businessId,
        date: { gte: startOfDay, lte: endOfDay },
        startTime,
        notified: false,
        expired: false,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!nextEntry) return;

    const bookingLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/book/${business.slug}?date=${date}&time=${startTime}`;

    await prisma.waitlistEntry.update({
      where: { id: nextEntry.id },
      data: { notified: true, notifiedAt: new Date() },
    });

    await notificationService.sendWaitlistOpened(nextEntry, business, bookingLink);

    // Set 30-minute expiry timer
    setTimeout(() => {
      this.expireAndCascade(nextEntry.id, businessId, date, startTime);
    }, 30 * 60 * 1000);
  }

  async expireAndCascade(entryId: string, businessId?: string, date?: string, startTime?: string): Promise<void> {
    const entry = await prisma.waitlistEntry.findUnique({ where: { id: entryId } });
    if (!entry || entry.expired) return;

    // Check if the entry was already converted (booking made)
    // For now, just mark as expired
    await prisma.waitlistEntry.update({
      where: { id: entryId },
      data: { expired: true },
    });

    const business = await prisma.business.findUnique({ where: { id: entry.businessId } });
    if (business) {
      await notificationService.sendWaitlistExpired(entry, business);
    }

    // Notify next in queue
    if (entry.businessId && entry.date && entry.startTime) {
      const dateStr = entry.date.toISOString().split('T')[0];
      await this.notifyNext(entry.businessId, dateStr, entry.startTime);
    }
  }

  async getWaitlistForSlot(businessId: string, date: string, startTime: string) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

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
      const startOfDay = new Date(filters.date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(filters.date);
      endOfDay.setHours(23, 59, 59, 999);
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
    return prisma.waitlistEntry.delete({
      where: { id: entryId, businessId },
    });
  }

  async manuallyNotify(businessId: string, entryId: string) {
    const entry = await prisma.waitlistEntry.findFirst({
      where: { id: entryId, businessId },
    });
    if (!entry) throw new Error('Waitlist entry not found');

    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new Error('Business not found');

    const dateStr = entry.date.toISOString().split('T')[0];
    const bookingLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/book/${business.slug}?date=${dateStr}&time=${entry.startTime}`;

    await prisma.waitlistEntry.update({
      where: { id: entryId },
      data: { notified: true, notifiedAt: new Date() },
    });

    await notificationService.sendWaitlistOpened(entry, business, bookingLink);

    return entry;
  }
}

export const waitlistService = new WaitlistService();