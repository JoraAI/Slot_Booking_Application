import prisma from '../lib/prisma';

/**
 * DB-configurable per-message pricing (integer paise). No hard-coded Meta rates in
 * send logic — getPricePaise returns null when no active row matches, which makes
 * the send path skip WhatsApp (booking flows are unaffected).
 */
class WhatsAppPricingService {
  async getPricePaise(category: string, country = 'IN', currency = 'INR', now: Date = new Date()): Promise<number | null> {
    const row = await prisma.whatsAppPricing.findFirst({
      where: {
        country,
        currency,
        category,
        active: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    return row ? row.pricePaise : null;
  }

  async list(now: Date = new Date()): Promise<Array<{ category: string; country: string; pricePaise: number }>> {
    const rows = await prisma.whatsAppPricing.findMany({
      where: {
        active: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      orderBy: [{ country: 'asc' }, { category: 'asc' }],
    });
    return rows.map((r) => ({ category: r.category, country: r.country, pricePaise: r.pricePaise }));
  }

  async upsert(row: {
    category: string;
    country?: string;
    currency?: string;
    pricePaise: number;
    effectiveTo?: Date | null;
    active?: boolean;
  }) {
    const country = row.country || 'IN';
    const currency = row.currency || 'INR';
    if (!Number.isInteger(row.pricePaise) || row.pricePaise < 0) {
      throw new Error('Invalid price (integer paise required)');
    }
    return prisma.whatsAppPricing.upsert({
      where: { country_currency_category: { country, currency, category: row.category } },
      create: {
        country,
        currency,
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
