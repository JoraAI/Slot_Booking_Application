/**
 * Extend demo / seeded salon subscriptions for 1 year so booking window works.
 * Run: npx tsx --env-file=.env scripts/fix-demo-subscription.ts
 */
import prisma from '../src/lib/prisma';
import { subscriptionService } from '../src/services/SubscriptionService';

const DEMO_SLUGS = ['demo-salon', 'eclat-unisex-salon'];

async function extendOneYear(businessId: string) {
  const oneYearFromNow = new Date();
  oneYearFromNow.setUTCFullYear(oneYearFromNow.getUTCFullYear() + 1);
  const monthKey = new Date().toISOString().slice(0, 7);

  const biz = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { bookingWindowDays: true },
  });

  await prisma.business.update({
    where: { id: businessId },
    data: {
      subscriptionPlan: 'YEARLY_799',
      subscriptionStatus: 'ACTIVE',
      subscriptionPaidUntil: oneYearFromNow,
      subscriptionLastPaidAt: new Date(),
      subscriptionCommissionPaidForMonth: monthKey,
      subscriptionCommissionPaidInr: 999999,
      bookingWindowDays: Math.max(biz.bookingWindowDays, 7),
    },
  });
}

async function main() {
  for (const slug of DEMO_SLUGS) {
    const biz = await prisma.business.findFirst({
      where: { slug },
      select: {
        id: true, name: true, slug: true, ownerEmail: true, bookingWindowDays: true,
        subscriptionPlan: true, subscriptionStatus: true,
      },
    });
    if (!biz) {
      console.log(`Skip: ${slug} not found`);
      continue;
    }

    const before = await subscriptionService.getSubscriptionView(biz.id);
    console.log(`\n${biz.name} (${biz.slug})`);
    console.log('Before:', { effectiveWindow: before.isActive ? biz.bookingWindowDays : 0, status: before.status });

    await extendOneYear(biz.id);

    const after = await subscriptionService.getSubscriptionView(biz.id);
    const updated = await prisma.business.findUnique({
      where: { id: biz.id },
      select: { bookingWindowDays: true, subscriptionPaidUntil: true },
    });
    console.log('After:', {
      effectiveWindow: after.isActive ? updated!.bookingWindowDays : 0,
      status: after.status,
      paidUntil: updated!.subscriptionPaidUntil?.toISOString(),
    });
  }
  console.log('\n✅ Done');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
