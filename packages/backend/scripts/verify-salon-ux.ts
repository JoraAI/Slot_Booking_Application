/**
 * Smoke: analytics collections fields + page structure markers.
 * Run: npx tsx --env-file=.env scripts/verify-salon-ux.ts
 */
import prisma from '../src/lib/prisma';
import { analyticsService } from '../src/services/AnalyticsService';
import fs from 'fs';
import path from 'path';

async function main() {
  const biz = await prisma.business.findFirst({
    where: { OR: [{ slug: 'demo-salon' }, { ownerEmail: 'owner@demosalon.com' }] },
  });
  if (!biz) throw new Error('Demo business not found');

  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const data = await analyticsService.getAnalytics(biz.id, iso(from), iso(to)) as any;
  const rm = data.revenueMetrics || {};
  const pm = data.productMetrics || {};

  if (typeof rm.totalCollected !== 'number') throw new Error('totalCollected missing');
  if (typeof rm.productCollected !== 'number') throw new Error('productCollected missing');
  if (typeof rm.totalCollections !== 'number') throw new Error('totalCollections missing');

  const expected = Math.round(
    ((rm.totalCollected || 0) + (rm.invoiceCollected || 0) + (rm.productCollected || 0)) * 100
  ) / 100;
  if (rm.totalCollections !== expected) {
    throw new Error(`totalCollections mismatch: ${rm.totalCollections} !== ${expected}`);
  }
  if (rm.productCollected !== pm.totalRevenue) {
    throw new Error(`productCollected !== productMetrics.totalRevenue`);
  }

  console.log('Analytics collections OK:', {
    service: rm.totalCollected,
    invoices: rm.invoiceCollected ?? 0,
    product: rm.productCollected,
    total: rm.totalCollections,
  });

  const frontendRoot = path.join(__dirname, '../../frontend/src/dashboard/pages');
  const checks: Record<string, string[]> = {
    'Products.tsx': ['md:hidden', 'hidden md:block', 'Mark sale', 'stacked'],
    'Bookings.tsx': ['md:hidden', 'hidden md:block', 'View details', 'openDetail'],
    'Analytics.tsx': ['Total collections', 'Service collections', 'Product collections', 'md:hidden'],
  };
  for (const [file, needles] of Object.entries(checks)) {
    const text = fs.readFileSync(path.join(frontendRoot, file), 'utf8');
    for (const n of needles) {
      if (!text.includes(n)) throw new Error(`${file} missing "${n}"`);
    }
    console.log(`${file}: markers OK`);
  }

  console.log('\n✅ Salon UX verification passed');
}

main()
  .catch((e) => { console.error('\n❌', e.message || e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
