import { test } from 'node:test'
import assert from 'node:assert'
import { upiFirstDisplay } from './razorpayDisplay'

// Batch 2A §12.8 acceptance test 9: the Checkout config must be explicitly
// UPI-first — an explicit `sequence` and default ordering disabled.
test('UPI Checkout display config is explicitly UPI-first', () => {
  assert.deepStrictEqual(upiFirstDisplay.sequence, ['block.upi', 'block.other'])
  assert.strictEqual(upiFirstDisplay.preferences.show_default_blocks, false)
  assert.strictEqual(upiFirstDisplay.blocks.upi.name, 'Pay with UPI apps')
  // The single `upi` instrument covers every installed UPI app (GPay, PhonePe,
  // Paytm, BHIM, ...) via Razorpay UPI Intent — no raw VPA, no per-app buttons.
  assert.deepStrictEqual(upiFirstDisplay.blocks.upi.instruments, [{ method: 'upi' }])
  assert.ok(upiFirstDisplay.blocks.other.instruments.length > 0)
})
