import crypto from 'crypto';
import prisma from '../lib/prisma';
import { paymentService, REFUND_NOTES_KEY, LEGACY_REFUND_NOTES_KEY } from './PaymentService';
import { reminderService } from './ReminderService';

export interface RefundResult {
  status: 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED';
  amount: number; // rupees — what was actually collected (paymentAmount)
  amountMinor: number;
  razorpayRefundId: string | null;
  message: string;
  failureReason?: string | null;
}

export const REFUND_INITIATED_MESSAGE =
  'Refund initiated to your original payment method. It may be instant; otherwise allow 5\u20137 working days.';
export const REFUND_FAILED_MESSAGE =
  'Booking cancelled, but the automatic refund needs the salon to complete it. We have notified the salon.';

function isPaid(booking: any): boolean {
  return !!(booking?.razorpayPaymentId) && booking.paymentAmount != null && booking.paymentAmount > 0;
}

/** Match a Razorpay refund by the idempotency note we attach on creation. */
function notesMatch(refund: any, key: string | null | undefined): boolean {
  if (!key) return false;
  const notes = refund?.notes;
  if (Array.isArray(notes)) {
    return notes.some(
      (n: any) =>
        (n?.key === REFUND_NOTES_KEY || n?.key === LEGACY_REFUND_NOTES_KEY) &&
        String(n.value) === key
    );
  }
  if (notes && typeof notes === 'object') {
    return notes[REFUND_NOTES_KEY] === key || notes[LEGACY_REFUND_NOTES_KEY] === key;
  }
  return false;
}

/**
 * Batch 2A — durable, idempotent refund pipeline.
 *
 * - Cancellation + the durable refund intent commit atomically in
 *   `cancelBookingWithRefundIntent` BEFORE any Razorpay I/O, so a crash never
 *   leaves a paid booking cancelled with no refund row.
 * - Each PaymentRefund owns one stable `idempotencyKey`, sent as Razorpay
 *   `X-Refund-Idempotency` on every create/retry with a byte-identical body.
 * - PROCESSING rows without a refund id are never re-initiated from a request
 *   path; only the reconciliation cron retries them (same key).
 * - Razorpay status is mapped: processed → PROCESSED/refunded, pending →
 *   PROCESSING/refund_pending, failed → FAILED/refund_failed. 409 → reconcile.
 */
class RefundService {
  /**
   * Atomically cancel a booking and create/return its durable refund intent.
   * Advisory-locks the booking, tenant-scopes the re-read, idempotently sets
   * CANCELLED + cancelledAt, cancels pending reminders, and ensures the unique
   * PaymentRefund row for paid bookings. Commits before any network call.
   */
  async cancelBookingWithRefundIntent(
    business: { id: string },
    bookingId: string
  ): Promise<{ booking: any; refundIntent: any | null; createdIntent: boolean }> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'cancel:' + bookingId}, 0))`;

      const fresh = await tx.booking.findFirst({
        where: { id: bookingId, businessId: business.id },
        include: { staff: true },
      });
      if (!fresh) {
        const err: any = new Error('Booking not found');
        err.status = 404;
        throw err;
      }

      let cancelled = fresh;
      if (fresh.status !== 'CANCELLED') {
        cancelled = await tx.booking.update({
          where: { id: fresh.id },
          data: { status: 'CANCELLED', cancelledAt: new Date() },
          include: { staff: true },
        });
      }
      await reminderService.cancelForBooking(cancelled.id, tx);

      const { refundIntent, created } = await this.ensureRefundIntent(tx, cancelled);
      if (refundIntent && created) {
        await tx.booking.update({ where: { id: cancelled.id }, data: { paymentStatus: 'refund_pending' } });
      }
      return { booking: cancelled, refundIntent, createdIntent: created };
    });
  }

  /**
   * Ensure the durable refund intent for a paid booking WITHOUT cancelling it
   * (owner manual-refund flow). Idempotent and race-safe via an advisory lock.
   */
  async ensureRefundIntentForBooking(
    businessId: string,
    booking: { id: string }
  ): Promise<{ refundIntent: any | null; createdIntent: boolean }> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'refund:' + booking.id}, 0))`;
      const fresh = await tx.booking.findFirst({ where: { id: booking.id, businessId } });
      if (!fresh) {
        const err: any = new Error('Booking not found');
        err.status = 404;
        throw err;
      }
      const { refundIntent, created } = await this.ensureRefundIntent(tx, fresh);
      if (refundIntent && created) {
        await tx.booking.update({ where: { id: fresh.id }, data: { paymentStatus: 'refund_pending' } });
      }
      return { refundIntent, createdIntent: created };
    });
  }

  /** Create or return the single durable refund intent for a booking. */
  private async ensureRefundIntent(
    tx: any,
    booking: any
  ): Promise<{ refundIntent: any | null; created: boolean }> {
    const existing = await tx.paymentRefund.findUnique({ where: { bookingId: booking.id } });
    if (existing) return { refundIntent: existing, created: false };
    if (!isPaid(booking)) return { refundIntent: null, created: false };

    const created = await tx.paymentRefund.create({
      data: {
        businessId: booking.businessId,
        bookingId: booking.id,
        razorpayPaymentId: booking.razorpayPaymentId,
        idempotencyKey: crypto.randomUUID(),
        amountMinor: Math.round(booking.paymentAmount * 100),
        currency: booking.currency || 'INR',
        status: 'PROCESSING',
        initiatedAt: new Date(),
      },
    });
    return { refundIntent: created, created: true };
  }

  /**
   * Post-commit step: initiate or reconcile the external refund for a booking.
   * Returns null when there is nothing to refund. Never throws — failures are
   * persisted durably and surfaced in the result.
   */
  async initiateOrReconcileRefund(
    refundIntent: any | null,
    booking: any,
    opts: { createdIntent?: boolean } = {}
  ): Promise<RefundResult | null> {
    if (!refundIntent) return null;
    if (refundIntent.status === 'PROCESSED') return this.toResult(refundIntent);

    if (refundIntent.status === 'PROCESSING') {
      if (refundIntent.razorpayRefundId) return this.reconcileOne(refundIntent, booking);
      if (!opts.createdIntent) {
        // Another request owns this in-flight refund. Never start a second
        // external refund here — the reconciliation job retries with the SAME
        // idempotency key. Report the truthful current state.
        return this.toResult(refundIntent);
      }
      return this.initiateAndMap(refundIntent, booking);
    }

    // PENDING / FAILED → retry with the same idempotency key (deduped).
    return this.initiateAndMap(refundIntent, booking);
  }

  /** Durable reconciliation for PROCESSING rows (authenticated cron job). */
  async reconcileProcessingRefunds(limit = 20): Promise<number> {
    const rows = await prisma.paymentRefund.findMany({
      where: { status: 'PROCESSING' },
      take: limit,
      orderBy: { updatedAt: 'asc' },
      include: { booking: true },
    });

    let reconciled = 0;
    for (const row of rows) {
      const booking = row.booking;
      const before = (await prisma.paymentRefund.findUnique({ where: { id: row.id } }))?.status;
      await this.reconcileOne(row, booking);
      const after = (await prisma.paymentRefund.findUnique({ where: { id: row.id } }))?.status;
      if (before !== after) reconciled++;
    }
    return reconciled;
  }

  private async initiateAndMap(refundIntent: any, booking: any): Promise<RefundResult> {
    const amount = refundIntent.amountMinor / 100;
    try {
      const rzp = await paymentService.initiateRefund(
        refundIntent.razorpayPaymentId,
        amount,
        booking.businessId,
        refundIntent.idempotencyKey
      );
      return this.mapRazorpayRefund(refundIntent, rzp, booking);
    } catch (e: any) {
      if (e?.status === 409) {
        // "Already processing" for this key — reconcile, never re-create.
        return this.reconcileOne(refundIntent, booking);
      }
      if (e?.isNetworkError) {
        // Timeout: the request may or may not have reached Razorpay. Keep the
        // durable row PROCESSING; the reconciliation cron retries the same key.
        return this.toResult({ ...refundIntent, status: 'PROCESSING' });
      }
      const reason = e?.message || 'Razorpay refund initiation failed';
      await prisma.paymentRefund.update({
        where: { id: refundIntent.id },
        data: { status: 'FAILED', failureReason: reason },
      });
      await prisma.booking.update({ where: { id: booking.id }, data: { paymentStatus: 'refund_failed' } });
      return {
        status: 'FAILED',
        amount,
        amountMinor: refundIntent.amountMinor,
        razorpayRefundId: null,
        message: REFUND_FAILED_MESSAGE,
        failureReason: reason,
      };
    }
  }

  private async mapRazorpayRefund(refundIntent: any, rzp: any, booking: any): Promise<RefundResult> {
    const refundId = rzp?.id || refundIntent.razorpayRefundId || null;
    const status = rzp?.status; // 'processed' | 'pending' | 'failed' (older API responses may omit)
    const amount = refundIntent.amountMinor / 100;

    if (status === 'failed') {
      const reason = rzp?.error_reason || rzp?.error_description || 'Razorpay refund failed';
      await prisma.paymentRefund.update({
        where: { id: refundIntent.id },
        data: { status: 'FAILED', razorpayRefundId: refundId, failureReason: reason },
      });
      await prisma.booking.update({ where: { id: booking.id }, data: { paymentStatus: 'refund_failed' } });
      return { status: 'FAILED', amount, amountMinor: refundIntent.amountMinor, razorpayRefundId: refundId, message: REFUND_FAILED_MESSAGE, failureReason: reason };
    }

    if (status === 'pending') {
      await prisma.paymentRefund.update({
        where: { id: refundIntent.id },
        data: { status: 'PROCESSING', razorpayRefundId: refundId, failureReason: null },
      });
      await prisma.booking.update({ where: { id: booking.id }, data: { paymentStatus: 'refund_pending' } });
      return { status: 'PROCESSING', amount, amountMinor: refundIntent.amountMinor, razorpayRefundId: refundId, message: REFUND_INITIATED_MESSAGE, failureReason: null };
    }

    if (status === 'processed') {
      await prisma.paymentRefund.update({
        where: { id: refundIntent.id },
        data: { status: 'PROCESSED', razorpayRefundId: refundId, processedAt: new Date(), failureReason: null },
      });
      await prisma.booking.update({ where: { id: booking.id }, data: { paymentStatus: 'refunded' } });
      return { status: 'PROCESSED', amount, amountMinor: refundIntent.amountMinor, razorpayRefundId: refundId, message: REFUND_INITIATED_MESSAGE, failureReason: null };
    }

    // Absent / unknown status (Batch 2B P1): never claim PROCESSED. Stay
    // PROCESSING (booking refund_pending) and let the reconciliation cron
    // resolve the real status later.
    await prisma.paymentRefund.update({
      where: { id: refundIntent.id },
      data: { status: 'PROCESSING', razorpayRefundId: refundId, failureReason: null },
    });
    await prisma.booking.update({ where: { id: booking.id }, data: { paymentStatus: 'refund_pending' } });
    return { status: 'PROCESSING', amount, amountMinor: refundIntent.amountMinor, razorpayRefundId: refundId, message: REFUND_INITIATED_MESSAGE, failureReason: null };
  }

  private async reconcileOne(refundIntent: any, booking: any): Promise<RefundResult> {
    let rzp: any;
    try {
      rzp = await paymentService.fetchPaymentRefunds(refundIntent.razorpayPaymentId, booking.businessId);
    } catch {
      // Fetch failed (network/upstream): leave PROCESSING for the next tick.
      return this.toResult(refundIntent);
    }

    const items = Array.isArray(rzp?.items) ? rzp.items : Array.isArray(rzp) ? rzp : [];
    const target = refundIntent.razorpayRefundId
      ? items.find((r: any) => r.id === refundIntent.razorpayRefundId)
      : items.find((r: any) => notesMatch(r, refundIntent.idempotencyKey)) || (items.length === 1 ? items[0] : null);

    if (!target) {
      // No refund exists yet (crash before the network call): retry with the
      // same key — Razorpay dedupes, so this can never duplicate.
      return this.initiateAndMap(refundIntent, booking);
    }
    return this.mapRazorpayRefund({ ...refundIntent, razorpayRefundId: target.id }, target, booking);
  }

  private toResult(refund: any): RefundResult {
    return {
      status: refund.status,
      amount: refund.amountMinor / 100,
      amountMinor: refund.amountMinor,
      razorpayRefundId: refund.razorpayRefundId || null,
      message: refund.status === 'FAILED' ? REFUND_FAILED_MESSAGE : REFUND_INITIATED_MESSAGE,
      failureReason: refund.failureReason || null,
    };
  }
}

export const refundService = new RefundService();
export default refundService;
