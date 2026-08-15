import prisma from '../lib/prisma';
import { businessResolver } from './BusinessResolver';
import { availabilityService } from './AvailabilityService';
import { bookingService, normalizeSource, serviceDayLockKey, staffDayLockKey } from './BookingService';
import { pricingService } from './PricingService';
import { timeService } from './TimeService';
import { paymentService } from './PaymentService';
import { notificationService } from './NotificationService';
import { reminderService } from './ReminderService';

const HOLD_MINUTES = 10;

const HHMM = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

interface CustomerData {
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
}

/**
 * Single authoritative payment flow. All pricing, payment mode, amounts, and
 * booking data are computed server-side from persisted state. Client-supplied
 * amount/finalPrice/duration/endTime/paymentMode are never trusted.
 */
class PaymentFlowService {
  /**
   * Initiate a payment: validates, prices, and (unless free) creates a
   * 10-minute capacity hold backed by a PaymentAttempt row.
   */
  async initiate(identifier: string, body: {
    serviceId: string;
    staffId?: string | null;
    date: string;
    startTime: string;
    customerName: string;
    customerPhone: string;
    customerEmail?: string | null;
    formData?: any;
    source?: string | null;
  }) {
    const business = await businessResolver.resolveOrThrow(identifier);
    const tz = business.timezone || 'Asia/Kolkata';

    const service = await prisma.service.findFirst({
      where: { id: body.serviceId, businessId: business.id, isActive: true },
    });
    if (!service) {
      const err: any = new Error('Service not found or inactive');
      err.status = 404;
      throw err;
    }

    let staffId: string | null = null;
    if (service.resourceMode === 'STAFF_BASED') {
      if (body.staffId) {
        const assigned = await prisma.staffService.findFirst({
          where: { serviceId: service.id, businessId: business.id, staffId: body.staffId, staff: { isActive: true } },
        });
        if (!assigned) {
          throw new Error('Selected staff member is not assigned to this service');
        }
        staffId = body.staffId;
      }
    }

    // Pricing at the business-local date/time (authoritative).
    const pricing = pricingService.computePricing(service, timeService.toUtc(tz, body.date, body.startTime));

    // Payment mode is decided by the business config only.
    const mode: 'full' | 'deposit' = business.paymentMode === 'deposit' ? 'deposit' : 'full';
    let payable = pricing.finalPrice;
    if (mode === 'deposit') {
      if (business.depositAmount != null) payable = Math.min(business.depositAmount, pricing.finalPrice);
      else if (business.depositPercentage != null) payable = (pricing.finalPrice * business.depositPercentage) / 100;
    }
    payable = round2(payable);
    const payableMinor = pricingService.toMinorUnits(payable);

    const customerData: CustomerData = {
      customerName: body.customerName,
      customerPhone: body.customerPhone,
      customerEmail: body.customerEmail || null,
    };
    const formData = body.formData || {};
    const source = normalizeSource(body.source);

    const [startH, startM] = body.startTime.split(':').map(Number);
    const endMin = startH * 60 + startM + service.durationMinutes;
    const occupiedEndMin = endMin + (service.bufferMinutes || 0);
    const endTime = HHMM(endMin);
    const occupiedEndTime = HHMM(occupiedEndMin);

    // finalPrice = 0 bypasses Razorpay: create a normal, authoritative booking.
    if (pricing.finalPrice <= 0) {
      const booking = await bookingService.createBooking(business.publicCode, {
        date: body.date,
        startTime: body.startTime,
        serviceId: service.id,
        staffId,
        customerName: customerData.customerName,
        customerPhone: customerData.customerPhone,
        customerEmail: customerData.customerEmail,
        formData,
        paymentAmount: 0,
        source,
      });
      await notificationService.sendBookingConfirmation(booking, booking.business);
      await reminderService.scheduleForBooking(booking.business, booking);
      return { success: true, free: true, booking };
    }

    // Day-scoped resource lock SHARED with the unpaid/free/recurring booking
    // create path (Batch 3A): a payment hold and a plain booking for the same
    // service-day (POOLED) or staff-day (STAFF_BASED) serialize against each
    // other, so overlapping-start and shared-staff races can never both pass
    // their availability re-checks.
    const attempt = await prisma.$transaction(async (tx) => {
      let resolvedStaffId = staffId;
      if (service.resourceMode === 'STAFF_BASED') {
        // Auto-assign: resolve the staff first so we can lock the staff-day;
        // the authoritative re-check below runs under the lock.
        if (!resolvedStaffId) {
          const probe = await availabilityService.computeAvailability(business, service, body.date, undefined, { client: tx });
          const probeSlot = probe.slots.find((s) => s.startTime === body.startTime);
          if (!probeSlot) throw new Error('Slot is no longer available');
          resolvedStaffId = probeSlot.eligibleStaffIds[0] || null;
          if (!resolvedStaffId) throw new Error('No assigned staff member is available for this slot');
        }
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${staffDayLockKey(business.id, resolvedStaffId!, body.date)}, 0))`;
      } else {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${serviceDayLockKey(business.id, service.id, body.date)}, 0))`;
      }

      // Authoritative availability re-check under the lock.
      const availability = await availabilityService.computeAvailability(
        business,
        service,
        body.date,
        service.resourceMode === 'STAFF_BASED' ? resolvedStaffId || undefined : undefined,
        { client: tx }
      );
      const slot = availability.slots.find((s) => s.startTime === body.startTime);
      if (!slot) throw new Error('Slot is no longer available');
      if (service.resourceMode === 'STAFF_BASED') {
        if (resolvedStaffId && !slot.eligibleStaffIds.includes(resolvedStaffId)) {
          throw new Error('Selected staff member is no longer available for this slot');
        }
        resolvedStaffId = resolvedStaffId || slot.eligibleStaffIds[0] || null;
        if (!resolvedStaffId) throw new Error('No assigned staff member is available for this slot');
      }

      return tx.paymentAttempt.create({
        data: {
          businessId: business.id,
          serviceId: service.id,
          staffId: resolvedStaffId,
          date: timeService.dateToUtcMidnight(body.date),
          startTime: body.startTime,
          endTime,
          occupiedEndTime,
          customerData: customerData as any,
          formData,
          originalPrice: pricing.originalPrice,
          discountAmount: pricing.discountAmount,
          finalPrice: pricing.finalPrice,
          payableMinor,
          paymentMode: mode,
          currency: 'INR',
          status: 'INITIATING',
          holdExpiresAt: new Date(Date.now() + HOLD_MINUTES * 60000),
          source,
        },
      });
    });

    // Create the Razorpay order OUTSIDE the DB transaction. On failure, the
    // hold is released by marking the attempt FAILED.
    let order;
    try {
      order = await paymentService.createOrder(payable, 'INR', `rcpt_${attempt.id.slice(0, 8)}`, business.id);
    } catch (e: any) {
      await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'FAILED' } });
      throw e;
    }

    const updated = await prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: { razorpayOrderId: order.id, status: 'PENDING' },
    });

    return {
      attemptId: updated.id,
      orderId: updated.razorpayOrderId,
      amount: updated.payableMinor,
      currency: updated.currency,
      key: business.razorpayKeyId || process.env.RAZORPAY_KEY_ID,
      name: business.name,
      payable,
      pricing: {
        originalPrice: pricing.originalPrice,
        discountAmount: pricing.discountAmount,
        finalPrice: pricing.finalPrice,
        discountLabel: pricing.discountLabel,
      },
      prefill: customerData,
    };
  }

  /**
   * Verify a Razorpay payment and create the booking from server-held attempt
   * data only. Idempotent: repeated/concurrent verifies produce at most one
   * booking and return the existing one.
   */
  async verify(identifier: string, payload: {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  }) {
    const business = await businessResolver.resolveOrThrow(identifier);

    const attempt = await prisma.paymentAttempt.findFirst({
      where: { razorpayOrderId: payload.razorpay_order_id, businessId: business.id },
    });
    if (!attempt) {
      const err: any = new Error('Payment attempt not found');
      err.status = 404;
      throw err;
    }

    // Idempotent replay: already consumed and linked to a booking.
    if (attempt.status === 'CONSUMED' && attempt.bookingId) {
      const existing = await prisma.booking.findUnique({
        where: { id: attempt.bookingId },
        include: { staff: true, business: true, service: true },
      });
      if (existing) return { success: true, idempotent: true, booking: existing };
    }

    if (attempt.status === 'FAILED' || attempt.status === 'CANCELLED' || attempt.status === 'EXPIRED') {
      throw new Error(`Payment attempt is ${attempt.status.toLowerCase()}`);
    }

    if ((attempt.status === 'INITIATING' || attempt.status === 'PENDING') && attempt.holdExpiresAt < new Date()) {
      await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'EXPIRED' } });
      throw new Error('Payment attempt expired; please start a new booking');
    }

    const isValid = await paymentService.verifyPayment(
      attempt.razorpayOrderId!,
      payload.razorpay_payment_id,
      payload.razorpay_signature,
      business.id
    );
    if (!isValid) {
      await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'FAILED' } });
      throw new Error('Payment verification failed');
    }

    const customerData = (attempt.customerData as any) as CustomerData;
    const dateStr = timeService.toDateStr(attempt.date, business.timezone || 'Asia/Kolkata');

    // Conditional consume + booking creation in one transaction. Only the
    // transaction that flips PENDING -> CONSUMED may create the booking;
    // concurrent verifies observe CONSUMED and return idempotently.
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.paymentAttempt.updateMany({
        where: { id: attempt.id, status: 'PENDING', razorpayOrderId: attempt.razorpayOrderId },
        data: { status: 'CONSUMED', consumedAt: new Date() },
      });
      if (updated.count === 0) {
        const current = await tx.paymentAttempt.findUnique({ where: { id: attempt.id } });
        if (current?.status === 'CONSUMED' && current.bookingId) {
          const existing = await tx.booking.findUnique({
            where: { id: current.bookingId },
            include: { staff: true, business: true, service: true },
          });
          if (existing) return { booking: existing, idempotent: true };
        }
        throw new Error('Payment attempt cannot be processed');
      }

      const booking = await bookingService.createBooking(
        business.publicCode,
        {
          date: dateStr,
          startTime: attempt.startTime,
          serviceId: attempt.serviceId!,
          staffId: attempt.staffId,
          customerName: customerData.customerName,
          customerPhone: customerData.customerPhone,
          customerEmail: customerData.customerEmail || null,
          formData: attempt.formData || {},
          paymentStatus: 'paid',
          paymentAmount: attempt.payableMinor / 100,
          razorpayOrderId: attempt.razorpayOrderId!,
          razorpayPaymentId: payload.razorpay_payment_id,
          source: attempt.source,
        },
        { client: tx, excludeAttemptId: attempt.id }
      );

      await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data: { bookingId: booking.id },
      });
      return { booking, idempotent: false };
    });

    // Notifications + reminders are sent only by the transaction that actually
    // created the booking. Idempotent replays return the existing booking as-is.
    if (!result.idempotent) {
      await notificationService.sendBookingConfirmation(result.booking, result.booking.business);
      await notificationService.sendPaymentReceipt(result.booking, business);
      await reminderService.scheduleForBooking(result.booking.business, result.booking);
    }

    return { success: true, booking: result.booking, idempotent: result.idempotent };
  }

  /**
   * Durable cleanup: expire stale holds. Called from the authenticated cron
   * path. Idempotent by status guard.
   */
  async expireStaleHolds(now: Date = new Date()): Promise<number> {
    const result = await prisma.paymentAttempt.updateMany({
      where: { status: { in: ['INITIATING', 'PENDING'] }, holdExpiresAt: { lt: now } },
      data: { status: 'EXPIRED' },
    });
    return result.count;
  }
}

export const paymentFlowService = new PaymentFlowService();
export default paymentFlowService;
