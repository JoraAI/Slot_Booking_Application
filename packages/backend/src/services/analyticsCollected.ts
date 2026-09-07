const PAID_STATES = new Set(['paid', 'partial']);
const REFUND_STATES = new Set(['refunded', 'refund_pending', 'refund_failed']);

/** Money still held from a booking — listed price of cancelled/unpaid rows is not collected. */
export function netCollectedAmount(b: {
  status?: string | null;
  paymentStatus?: string | null;
  paymentAmount?: number | null;
}): number {
  if (b.status === 'CANCELLED') return 0;
  if (!PAID_STATES.has(b.paymentStatus || '')) return 0;
  if (REFUND_STATES.has(b.paymentStatus || '')) return 0;
  return b.paymentAmount || 0;
}

/**
 * Whether an invoice should add to analytics collections.
 * - Skip booking_paid (already counted via Booking.paymentAmount).
 * - Skip booking_completed when the linked booking is already paid/partial
 *   (Razorpay or cash invoice sync) to avoid double-counting.
 * - Count walk_in / manual / unpaid booking_completed cash invoices.
 *
 * Callers must query booking_completed by appointment date and walk_in/manual
 * by issuedAt so date windows stay consistent with booking collections.
 */
export function invoiceCollectedAmount(inv: {
  source?: string | null;
  total?: number | null;
  booking?: {
    status?: string | null;
    paymentStatus?: string | null;
    paymentAmount?: number | null;
  } | null;
}): number {
  const source = inv.source || 'manual';
  if (source === 'booking_paid') return 0;
  if (inv.booking && inv.booking.status === 'CANCELLED') return 0;
  if (inv.booking && netCollectedAmount(inv.booking) > 0) return 0;
  if (source === 'booking_completed' || source === 'walk_in' || source === 'manual') {
    return inv.total || 0;
  }
  return 0;
}
