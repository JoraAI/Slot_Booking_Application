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
   * Initiate a refund (or mock in test mode)
   */
  async initiateRefund(
    paymentId: string,
    amount?: number,
    businessId?: string
  ): Promise<any> {
    // Test mode: return mock refund
    if (paymentId.startsWith('pay_test_') || (businessId && await this.isTestMode(businessId))) {
      return {
        id: `rfnd_test_${Date.now()}`,
        entity: 'refund',
        amount: amount ? Math.round(amount * 100) : undefined,
        currency: 'INR',
        payment_id: paymentId,
        status: 'processed',
        created_at: Math.floor(Date.now() / 1000),
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

    const body: any = {};
    if (amount) {
      body.amount = Math.round(amount * 100);
    }

    const response = await fetch(
      `https://api.razorpay.com/v1/payments/${paymentId}/refund`,
      { method: 'POST', headers, body: JSON.stringify(body) }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Refund failed: ${JSON.stringify(error)}`);
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