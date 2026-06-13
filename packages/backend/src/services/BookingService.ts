import prisma from '../lib/prisma';
import { availabilityService } from './AvailabilityService';

class BookingService {
  async createBooking(slug: string, data: {
    date: string;
    startTime: string;
    staffId?: string;
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    formData?: any;
    isRecurring?: boolean;
    recurringRule?: string;
    recurringGroupId?: string;
    paymentStatus?: string;
    paymentAmount?: number;
    razorpayOrderId?: string;
    razorpayPaymentId?: string;
  }) {
    const business = await prisma.business.findUnique({ where: { slug } });
    if (!business) throw new Error('Business not found');

    const bookingDate = new Date(data.date);
    const [startH, startM] = data.startTime.split(':').map(Number);
    const endTimeMinutes = startH * 60 + startM + business.slotDurationMinutes;
    const endH = Math.floor(endTimeMinutes / 60);
    const endM = endTimeMinutes % 60;
    const endTime = `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;

    // Check availability
    const { slots } = await availabilityService.getAvailability(slug, data.date, data.staffId);
    const slot = slots.find(s => s.time === data.startTime);
    if (!slot || !slot.isAvailable) {
      throw new Error('Slot is no longer available');
    }

    // Check staff exists if provided
    if (data.staffId) {
      const staff = await prisma.staff.findFirst({
        where: { id: data.staffId, businessId: business.id, isActive: true },
      });
      if (!staff) throw new Error('Staff member not found or inactive');
    }

    const booking = await prisma.booking.create({
      data: {
        businessId: business.id,
        staffId: data.staffId || null,
        date: bookingDate,
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
      include: { staff: true, business: true },
    });

    return booking;
  }

  async getBooking(slug: string, bookingId: string) {
    const business = await prisma.business.findUnique({ where: { slug } });
    if (!business) throw new Error('Business not found');

    return prisma.booking.findFirst({
      where: { id: bookingId, businessId: business.id },
      include: { staff: true },
    });
  }

  async updateBooking(slug: string, bookingId: string, data: {
    status?: string;
    customerName?: string;
    customerPhone?: string;
    customerEmail?: string;
    formData?: any;
    date?: string;
    startTime?: string;
    staffId?: string;
  }) {
    const business = await prisma.business.findUnique({ where: { slug } });
    if (!business) throw new Error('Business not found');

    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, businessId: business.id },
    });
    if (!booking) throw new Error('Booking not found');

    const updateData: any = { ...data };
    if (data.date) updateData.date = new Date(data.date);
    if (data.status === 'CANCELLED') updateData.cancelledAt = new Date();

    if (data.startTime) {
      const [startH, startM] = data.startTime.split(':').map(Number);
      const endTimeMinutes = startH * 60 + startM + business.slotDurationMinutes;
      const endH = Math.floor(endTimeMinutes / 60);
      const endM = endTimeMinutes % 60;
      updateData.endTime = `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
    }

    return prisma.booking.update({
      where: { id: bookingId },
      data: updateData,
      include: { staff: true },
    });
  }

  async cancelBooking(slug: string, bookingId: string) {
    return this.updateBooking(slug, bookingId, { status: 'CANCELLED' });
  }

  async getOwnerBookings(businessId: string, filters?: {
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    staffId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = { businessId };
    if (filters?.status) where.status = filters.status;
    if (filters?.staffId) where.staffId = filters.staffId;
    if (filters?.dateFrom || filters?.dateTo) {
      where.date = {};
      if (filters.dateFrom) where.date.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.date.lte = new Date(filters.dateTo);
    }

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: { staff: true },
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
    if (!booking) throw new Error('Booking not found');

    return prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: status as any,
        ...(status === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
      },
      include: { staff: true, business: true },
    });
  }
}

export const bookingService = new BookingService();