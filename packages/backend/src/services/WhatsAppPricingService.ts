import prisma from '../lib/prisma';
import { getWhatsappProvider, type WhatsappProvider } from './notificationCredentials';

/**
 * DB-configurable per-message pricing (integer paise), keyed by active WhatsApp provider.
 * Markup target ≈ 1.2× modeled wholesale (Meta fee; + Twilio $0.005 when on Twilio;
 * Gupshup defaults to Meta rates).
 */
class WhatsAppPricingService {
  async getPricePaise(
    category: string,
    country = 'IN',
    currency = 'INR',
    now: Date = new Date(),
    provider: WhatsappProvider = getWhatsappProvider()
  ): Promise<number | null> {
    const row = await prisma.whatsAppPricing.findFirst({
      where: {
        country,
        currency,
        category,
        provider,
        active: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    return row ? row.pricePaise : null;
  }

  async list(
    now: Date = new Date(),
    provider: WhatsappProvider = getWhatsappProvider()
  ): Promise<Array<{ category: string; country: string; provider: string; pricePaise: number }>> {
    const rows = await prisma.whatsAppPricing.findMany({
      where: {
        provider,
        active: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      orderBy: [{ country: 'asc' }, { category: 'asc' }],
    });
    return rows.map((r) => ({
      category: r.category,
      country: r.country,
      provider: r.provider,
      pricePaise: r.pricePaise,
    }));
  }

  async upsert(row: {
    category: string;
    country?: string;
    currency?: string;
    provider?: WhatsappProvider;
    pricePaise: number;
    effectiveTo?: Date | null;
    active?: boolean;
  }) {
    const country = row.country || 'IN';
    const currency = row.currency || 'INR';
    const provider = row.provider || getWhatsappProvider();
    if (!Number.isInteger(row.pricePaise) || row.pricePaise < 0) {
      throw new Error('Invalid price (integer paise required)');
    }
    return prisma.whatsAppPricing.upsert({
      where: {
        country_currency_category_provider: { country, currency, category: row.category, provider },
      },
      create: {
        country,
        currency,
        provider,
        category: row.category,
        pricePaise: row.pricePaise,
        effectiveTo: row.effectiveTo,
        active: row.active ?? true,
      },
      update: {
        pricePaise: row.pricePaise,
        effectiveTo: row.effectiveTo,
        active: row.active ?? true,
      },
    });
  }
}

export const whatsappPricingService = new WhatsAppPricingService();
