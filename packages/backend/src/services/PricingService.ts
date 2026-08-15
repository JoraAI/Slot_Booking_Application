/**
 * Single authoritative pricing engine for services.
 *
 * All price/discount output — public config display, booking snapshots,
 * Razorpay order amounts, confirmation messages, and analytics — must come
 * from this service. Browser-supplied prices/discounts are never authoritative.
 */

export interface PricingResult {
  originalPrice: number;
  discountAmount: number;
  finalPrice: number;
  discountLabel: string | null;
  discountType: 'PERCENTAGE' | 'FLAT' | null;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

class PricingService {
  /**
   * @param service  A Service row (price + discount fields).
   * @param at       The absolute UTC instant (derived from the business-local
   *                 date/time) at which the discount window is evaluated.
   */
  computePricing(service: {
    price: number;
    discountType?: string | null;
    discountValue?: number | null;
    discountLabel?: string | null;
    discountValidFrom?: Date | null;
    discountValidUntil?: Date | null;
    discountActive?: boolean;
  }, at: Date): PricingResult {
    const originalPrice = round2(Math.max(0, service.price || 0));

    let discountAmount = 0;
    let discountLabel: string | null = null;
    let discountType: 'PERCENTAGE' | 'FLAT' | null = null;

    const discountConfigured =
      !!service.discountActive &&
      (service.discountType === 'PERCENTAGE' || service.discountType === 'FLAT') &&
      typeof service.discountValue === 'number' &&
      service.discountValue > 0;

    let inWindow = discountConfigured;
    if (inWindow && service.discountValidFrom) {
      inWindow = at >= service.discountValidFrom;
    }
    if (inWindow && service.discountValidUntil) {
      inWindow = at <= service.discountValidUntil;
    }

    if (inWindow) {
      if (service.discountType === 'PERCENTAGE') {
        const pct = Math.min(100, Math.max(0, service.discountValue || 0));
        discountAmount = (originalPrice * pct) / 100;
      } else {
        discountAmount = Math.max(0, service.discountValue || 0);
      }
      // Clamp discount to original price
      discountAmount = Math.min(discountAmount, originalPrice);
      discountLabel = service.discountLabel || null;
      discountType = service.discountType as 'PERCENTAGE' | 'FLAT';
    }

    const finalPrice = round2(Math.max(0, originalPrice - discountAmount));

    return {
      originalPrice,
      discountAmount: round2(discountAmount),
      finalPrice,
      discountLabel,
      discountType,
    };
  }

  /** Amount in minor currency units (paise) for Razorpay. */
  toMinorUnits(amount: number): number {
    return Math.round(amount * 100);
  }
}

export const pricingService = new PricingService();
