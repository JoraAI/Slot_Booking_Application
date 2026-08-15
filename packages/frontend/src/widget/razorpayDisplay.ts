/**
 * Razorpay Checkout `display` configuration — explicitly UPI-first (Batch 2A).
 *
 * - `sequence: ['block.upi', 'block.other']` fixes the block order; Razorpay
 *   will not reorder the blocks.
 * - `preferences.show_default_blocks: false` disables the default instrument
 *   list so the configured blocks are the only payment surface.
 * - The `upi` instrument is Razorpay UPI Intent: installed UPI apps (Google
 *   Pay, PhonePe, Paytm, BHIM and any other app the Razorpay account supports)
 *   are surfaced automatically on mobile. No raw "receiver UPI ID" is used.
 */
export const upiFirstDisplay = {
  blocks: {
    upi: {
      name: 'Pay with UPI apps',
      instruments: [{ method: 'upi' }],
    },
    other: {
      name: 'More payment options',
      instruments: [
        { method: 'card' },
        { method: 'netbanking' },
        { method: 'wallet' },
      ],
    },
  },
  sequence: ['block.upi', 'block.other'],
  preferences: {
    show_default_blocks: false,
  },
} as const
