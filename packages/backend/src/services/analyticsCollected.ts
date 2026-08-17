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
