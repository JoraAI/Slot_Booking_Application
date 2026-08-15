import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { reminderService } from '../services/ReminderService';
import { paymentFlowService } from '../services/PaymentFlowService';
import { waitlistService } from '../services/WaitlistService';
import { refundService } from '../services/RefundService';

export const internalRouter = Router();

/**
 * Constant-time comparison to avoid leaking the CRON_SECRET via timing.
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Protect internal job endpoints with CRON_SECRET (header `x-cron-secret` or
 * body `secret`). Never exposed to the frontend.
 */
function requireCronSecret(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.CRON_SECRET;
  const provided = req.headers['x-cron-secret'] || req.body?.secret;
  if (!expected || !provided || !safeEqual(expected, String(provided))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

/**
 * POST /api/internal/jobs/process-reminders
 *
 * Durable, idempotent reminder dispatch for free-tier hosts that sleep between
 * requests. Intended to be called by an external scheduler.
 */
internalRouter.post('/jobs/process-reminders', requireCronSecret, async (_req: Request, res: Response) => {
  try {
    const processed = await reminderService.processDue();
    res.json({ success: true, processed, at: new Date().toISOString() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/internal/jobs/process-waitlist-expirations
 *
 * Durable waitlist expiry: marks notified entries past their 30-minute
 * `expiresAt` as expired and cascades to the next eligible entry only after an
 * authoritative availability check for that service/staff. Idempotent.
 */
internalRouter.post('/jobs/process-waitlist-expirations', requireCronSecret, async (_req: Request, res: Response) => {
  try {
    const expired = await waitlistService.processExpired();
    res.json({ success: true, expired, at: new Date().toISOString() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/internal/jobs/process-payment-expirations
 *
 * Expire stale PaymentAttempt capacity holds (10-minute holds whose holdExpiresAt
 * has passed). Idempotent: only INITIATING/PENDING rows are transitioned, so
 * capacity is released even before this runs (availability filters active,
 * unexpired holds only).
 */
internalRouter.post('/jobs/process-payment-expirations', requireCronSecret, async (_req: Request, res: Response) => {
  try {
    const expired = await paymentFlowService.expireStaleHolds();
    res.json({ success: true, expired, at: new Date().toISOString() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/internal/jobs/process-refund-reconciliation
 *
 * Durable reconciliation for PaymentRefund rows stuck in PROCESSING (Batch 2A):
 * fetches the payment's refunds from Razorpay and maps pending→PROCESSED or
 * failed→FAILED. PROCESSING rows without a refund id are retried with their
 * ORIGINAL idempotency key (Razorpay dedupes), so network-timeout retries can
 * never create a duplicate refund. Idempotent.
 */
internalRouter.post('/jobs/process-refund-reconciliation', requireCronSecret, async (_req: Request, res: Response) => {
  try {
    const reconciled = await refundService.reconcileProcessingRefunds();
    res.json({ success: true, reconciled, at: new Date().toISOString() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default internalRouter;
