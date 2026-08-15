import crypto from 'crypto';
import prisma from '../lib/prisma';

interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
}

class PaymentService {
  /** Test-mode refund cache: dedupes by idempotency key and supports list fetch. */
  private testRefundsByPayment = new Map<string, any[]>();
  private testRefundsByKey = new Map<string, any>();

  /** Build a structured Razorpay error carrying HTTP status / network flag. */
  private rzpError(message: string, opts: { status?: number; isNetworkError?: boolean } = {}): Error & { status?: number; isNetworkError?: boolean } {
    const err: any = new Error(message);
    if (opts.status) err.status = opts.status;
    if (opts.isNetworkError) err.isNetworkError = true;
    return err;
  }
  /**
   * Check if a business is in test mode
   */
  private async isTestMode(businessId: string): Promise<boolean> {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { razorpayTestMode: true },
    });
    return business?.razorpayTestMode ?? true;
  }

  /**
   * Get Razorpay auth headers using business-specific or env keys
   */
  private async getHeaders(businessId: string): Promise<Record<string, string>> {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { razorpayKeyId: true, razorpayKeySecret: true },
    });

    const keyId = business?.razorpayKeyId || process.env.RAZORPAY_KEY_ID || '';
    const keySecret = business?.razorpayKeySecret || process.env.RAZORPAY_KEY_SECRET || '';

    return {
      'Authorization': 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
      'Content-Type': 'application/json',
    };
  }

  /**
   * Create a Razorpay order (or mock in test mode)
   */
  async createOrder(
    amount: number,
    currency: string = 'INR',
    receipt: string,
    businessId?: string
  ): Promise<RazorpayOrder> {
    // Test mode: return a mock order
    if (businessId && await this.isTestMode(businessId)) {
      return {
        id: `order_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        amount: Math.round(amount * 100),
        currency,
        receipt,
        status: 'created',
      };
    }

    // Live mode: call Razorpay API
    const headers = businessId
      ? await this.getHeaders(businessId)
      : {
          'Authorization': 'Basic ' + Buffer.from(
            `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
          ).toString('base64'),
          'Content-Type': 'application/json',
        };

    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        amount: Math.round(amount * 100), // paise
        currency,
        receipt,
        payment_capture: 1,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Razorpay order creation failed: ${JSON.stringify(error)}`);
    }

    return response.json() as Promise<RazorpayOrder>;
  }

  /**
   * Verify payment signature (or auto-pass in test mode)
   */
  async verifyPayment(
    orderId: string,
    paymentId: string,
    signature: string,
    businessId?: string
  ): Promise<boolean> {
    // Test mode: auto-verify (orderId starts with "order_test_")
    if (orderId.startsWith('order_test_')) {
      return true;
    }

    // Live mode: verify HMAC
    const keySecret = process.env.RAZORPAY_KEY_SECRET || '';

    const business = businessId
      ? await prisma.business.findUnique({
          where: { id: businessId },
          select: { razorpayKeySecret: true },
        })
      : null;

    const secret = business?.razorpayKeySecret || keySecret;

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    return expectedSignature === signature;
  }

  /**
   * Initiate a refund (or mock in test mode). Always requests Razorpay speed
   * `optimum`: instant where the payment network supports it (e.g. UPI),
   * otherwise the normal banking timeline (5-7 working days).
   *
   * Batch 2A idempotency:
   * - `idempotencyKey` is sent as the `X-Refund-Idempotency` header so retries
   *   (network timeout, reconciliation) never create a duplicate refund.
   * - The request body is byte-for-byte identical for a repeated key (same
   *   amount, speed, and `notes` carrying the key).
   * - A Razorpay 409 ("already processing") surfaces as an error with
   *   `status === 409` for the caller to reconcile instead of re-creating.
   */
  async initiateRefund(
    paymentId: string,
    amount?: number,
    businessId?: string,
    idempotencyKey?: string
  ): Promise<any> {
    // Test mode: return a mock refund, deduplicated by idempotency key.
    if (paymentId.startsWith('pay_test_') || (businessId && await this.isTestMode(businessId))) {
      if (idempotencyKey && this.testRefundsByKey.has(idempotencyKey)) {
        return this.testRefundsByKey.get(idempotencyKey);
      }
      const refund: any = {
        id: `rfnd_test_${crypto.randomBytes(6).toString('hex')}`,
        entity: 'refund',
        amount: amount ? Math.round(amount * 100) : undefined,
        currency: 'INR',
        payment_id: paymentId,
        status: 'processed',
        speed: 'optimum',
        notes: idempotencyKey ? { slotbook_idempotency_key: idempotencyKey } : {},
        created_at: Math.floor(Date.now() / 1000),
      };
      if (idempotencyKey) this.testRefundsByKey.set(idempotencyKey, refund);
      const list = this.testRefundsByPayment.get(paymentId) || [];
      list.push(refund);
      this.testRefundsByPayment.set(paymentId, list);
      return refund;
    }

    // Live mode: call Razorpay API
    const headers = businessId
      ? await this.getHeaders(businessId)
      : {
          'Authorization': 'Basic ' + Buffer.from(
            `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
          ).toString('base64'),
          'Content-Type': 'application/json',
        };
    if (idempotencyKey) headers['X-Refund-Idempotency'] = idempotencyKey;

    const body: any = { speed: 'optimum' };
    if (amount) body.amount = Math.round(amount * 100);
    // Carry the stable key in notes (JSON object — the official Razorpay format)
    // so reconciliation can match a refund even before we have its refund id
    // (byte-identical for a repeated key).
    if (idempotencyKey) body.notes = { slotbook_idempotency_key: idempotencyKey };

    let response: Response;
    try {
      response = await fetch(
        `https://api.razorpay.com/v1/payments/${paymentId}/refund`,
        { method: 'POST', headers, body: JSON.stringify(body) }
      );
    } catch {
      throw this.rzpError('Refund request failed (network error). The refund may or may not have been created; retry with the same idempotency key.', { isNetworkError: true });
    }

    if (!response.ok) {
      let message = `Refund failed (HTTP ${response.status})`;
      try {
        const errorBody: any = await response.json();
        if (errorBody?.error?.description) message = `Refund failed: ${errorBody.error.description}`;
        else message = `Refund failed: ${JSON.stringify(errorBody)}`;
      } catch { /* keep default message */ }
      throw this.rzpError(message, { status: response.status });
    }

    return response.json();
  }

  /**
   * Fetch all refunds for a payment (used by reconciliation). Matches a refund
   * by id or by the `slotbook_idempotency_key` note we always attach.
   */
  async fetchPaymentRefunds(paymentId: string, businessId?: string): Promise<any> {
    if (paymentId.startsWith('pay_test_') || (businessId && await this.isTestMode(businessId))) {
      return { items: this.testRefundsByPayment.get(paymentId) || [] };
    }

    const headers = businessId
      ? await this.getHeaders(businessId)
      : {
          'Authorization': 'Basic ' + Buffer.from(
            `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
          ).toString('base64'),
          'Content-Type': 'application/json',
        };

    let response: Response;
    try {
      response = await fetch(
        `https://api.razorpay.com/v1/payments/${paymentId}/refunds`,
        { headers }
      );
    } catch {
      throw this.rzpError('Failed to fetch payment refunds (network error)', { isNetworkError: true });
    }

    if (!response.ok) {
      let message = 'Failed to fetch payment refunds';
      try {
        const errorBody = await response.json();
        message = `Failed to fetch payment refunds: ${JSON.stringify(errorBody)}`;
      } catch { /* keep default */ }
      throw this.rzpError(message, { status: response.status });
    }

    return response.json();
  }

  /**
   * Get payment details (or mock in test mode)
   */
  async getPaymentDetails(paymentId: string, businessId?: string): Promise<any> {
    if (paymentId.startsWith('pay_test_') || (businessId && await this.isTestMode(businessId))) {
      return {
        id: paymentId,
        entity: 'payment',
        amount: 10000,
        currency: 'INR',
        status: 'captured',
        method: 'upi',
        created_at: Math.floor(Date.now() / 1000),
      };
    }

    const headers = businessId
      ? await this.getHeaders(businessId)
      : {
          'Authorization': 'Basic ' + Buffer.from(
            `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
          ).toString('base64'),
          'Content-Type': 'application/json',
        };

    const response = await fetch(
      `https://api.razorpay.com/v1/payments/${paymentId}`,
      { headers }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch payment details');
    }

    return response.json();
  }
}

export const paymentService = new PaymentService();