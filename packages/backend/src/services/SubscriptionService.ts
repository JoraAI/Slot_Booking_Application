import prisma from '../lib/prisma';
import { timeService } from './TimeService';

type SubscriptionPlan = 'COMMISSION' | 'MONTHLY_799' | 'YEARLY_799';

interface SubscriptionView {
  plan: SubscriptionPlan;
  status: 'ACTIVE' | 'PAST_DUE';
  isActive: boolean;
  dueInr: number;
  paidInr: number;
  currentMonthKey: string | null; // YYYY-MM for commission
  currentCycleEndsAt: string | null; // ISO string
}

function currentMonthKey(tz: string, now: Date): string {
  const ymd = timeService.toDateStr(now, tz); // YYYY-MM-DD in tz
  return ymd.slice(0, 7); // YYYY-MM
}

function monthUtcRange(tz: string, now: Date): { gte: Date; lte: Date } {
  const ymd = timeService.toDateStr(now, tz); // YYYY-MM-DD
  const [yStr, mStr] = ymd.split('-');
  const y = Number(yStr);
  const m = Number(mStr); // 1..12
  const mm = String(m).padStart(2, '0');
  const startDateStr = `${y}-${mm}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month
  const endDateStr = `${y}-${mm}-${String(lastDay).padStart(2, '0')}`;
  const start = timeService.dateToUtcMidnight(startDateStr);
  const { lte } = timeService.dayRangeUtc(endDateStr);
  return { gte: start, lte };
}

function addMonthsUtc(at: Date, months: number): Date {
  const d = new Date(at.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

class SubscriptionService {
  async getSubscriptionView(businessId: string, now: Date = new Date()): Promise<SubscriptionView> {
    const business = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: {
        id: true,
        timezone: true,
        subscriptionPlan: true,
        subscriptionCommissionPercent: true,
        subscriptionMonthlyInr: true,
        subscriptionStatus: true,
        subscriptionPaidUntil: true,
        subscriptionCommissionPaidForMonth: true,
        subscriptionCommissionPaidInr: true,
      },
    });

    const tz = business.timezone || 'Asia/Kolkata';
    const plan = (business.subscriptionPlan || 'COMMISSION') as SubscriptionPlan;

    if (plan === 'COMMISSION') {
      const monthKey = currentMonthKey(tz, now);
      const { gte, lte } = monthUtcRange(tz, now);
      const bookings = await prisma.booking.findMany({
        where: {
          businessId: business.id,
          date: { gte, lte },
          // Include cancellations, per requirement.
        },
        select: { finalPrice: true, originalPrice: true },
      });

      const commissionPercent = business.subscriptionCommissionPercent ?? 5;
      const sumInr = bookings.reduce((acc, b) => {
        const amount = (b.finalPrice ?? b.originalPrice) ?? 0;
        return acc + (Number.isFinite(amount) ? amount : 0);
      }, 0);
      const dueInr = Math.max(0, Math.round((sumInr * commissionPercent) / 100));

      const paidForThisMonth = business.subscriptionCommissionPaidForMonth === monthKey;
      const paidInr = paidForThisMonth ? Number(business.subscriptionCommissionPaidInr ?? 0) : 0;

      const isActive = paidForThisMonth && paidInr >= dueInr && dueInr > 0 ? true : dueInr === 0 ? true : false;
      // If there is any due for the month and it isn't paid, mark overdue.
      const status: 'ACTIVE' | 'PAST_DUE' = isActive ? 'ACTIVE' : 'PAST_DUE';

      return {
        plan,
        status,
        isActive,
        dueInr,
        paidInr,
        currentMonthKey: dueInr > 0 ? monthKey : null,
        currentCycleEndsAt: dueInr > 0 ? lte.toISOString() : null,
      };
    }

    // MONTHLY_799 / YEARLY_799
    const monthly = Number(business.subscriptionMonthlyInr ?? 799);
    const dueInr = plan === 'YEARLY_799' ? monthly * 12 : monthly;
    const paidInr = 0;

    const paidUntil = business.subscriptionPaidUntil ? new Date(business.subscriptionPaidUntil) : null;
    const isActive = !!paidUntil && paidUntil.getTime() > now.getTime();
    const status: 'ACTIVE' | 'PAST_DUE' = isActive ? 'ACTIVE' : 'PAST_DUE';

    return {
      plan,
      status,
      isActive,
      dueInr,
      paidInr,
      currentMonthKey: null,
      currentCycleEndsAt: isActive ? paidUntil?.toISOString() ?? null : null,
    };
  }

  async selectPlan(businessId: string, plan: SubscriptionPlan): Promise<void> {
    const allowed: SubscriptionPlan[] = ['COMMISSION', 'MONTHLY_799', 'YEARLY_799'];
    if (!allowed.includes(plan)) throw new Error('Invalid subscription plan');

    // Reset payment trackers when changing plan so activation is recomputed correctly.
    await prisma.business.update({
      where: { id: businessId },
      data: {
        subscriptionPlan: plan,
        subscriptionStatus: 'ACTIVE',
        subscriptionPaidUntil: null,
        subscriptionCommissionPaidForMonth: null,
        subscriptionCommissionPaidInr: 0,
        subscriptionLastPaidAt: null,
      },
    });
  }

  async markPaid(businessId: string, now: Date = new Date()): Promise<{ dueInr: number; plan: SubscriptionPlan }> {
    const view = await this.getSubscriptionView(businessId, now);
    const plan = view.plan;

    if (plan === 'COMMISSION') {
      if (!view.currentMonthKey) {
        // Nothing due — still keep ACTIVE.
        await prisma.business.update({
          where: { id: businessId },
          data: { subscriptionStatus: 'ACTIVE' },
        });
        return { dueInr: 0, plan };
      }

      await prisma.business.update({
        where: { id: businessId },
        data: {
          subscriptionCommissionPaidForMonth: view.currentMonthKey,
          subscriptionCommissionPaidInr: view.dueInr,
          subscriptionLastPaidAt: now,
          subscriptionStatus: 'ACTIVE',
        },
      });
      return { dueInr: view.dueInr, plan };
    }

    const monthly = Number((await prisma.business.findUnique({ where: { id: businessId }, select: { subscriptionMonthlyInr: true } }))?.subscriptionMonthlyInr ?? 799);
    const months = plan === 'YEARLY_799' ? 12 : 1;
    const paidUntil = addMonthsUtc(now, months);

    await prisma.business.update({
      where: { id: businessId },
      data: {
        subscriptionPaidUntil: paidUntil,
        subscriptionLastPaidAt: now,
        subscriptionStatus: 'ACTIVE',
        subscriptionCommissionPaidForMonth: null,
        subscriptionCommissionPaidInr: 0,
        subscriptionMonthlyInr: monthly,
      },
    });

    return { dueInr: view.dueInr, plan };
  }

  async isActiveOrThrow(identifier: string): Promise<boolean> {
    // Left intentionally unused in routes for now.
    return identifier ? true : false;
  }
}

export const subscriptionService = new SubscriptionService();

