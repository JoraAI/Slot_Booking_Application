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
  currentCycleEndsAt: string | null; // ISO string — paid-until or commission period end
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

export function addMonthsUtc(at: Date, months: number): Date {
  const d = new Date(at.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/** Pure helpers for unit tests — same rules as getSubscriptionView for fixed plans. */
export function fixedPlanDueAndCycle(input: {
  plan: 'MONTHLY_799' | 'YEARLY_799';
  monthlyInr: number;
  paidUntil: Date | null;
  now: Date;
  isTrial: boolean;
}): Pick<SubscriptionView, 'dueInr' | 'paidInr' | 'isActive' | 'status' | 'currentCycleEndsAt'> {
  const fullDue = input.plan === 'YEARLY_799' ? input.monthlyInr * 12 : input.monthlyInr;
  const paidUntil = input.paidUntil;
  const isPaidThrough = !!paidUntil && paidUntil.getTime() > input.now.getTime();

  if (input.isTrial && !isPaidThrough) {
    // Trial stays active, but owners may optionally prepay to lock the cycle.
    return {
      dueInr: fullDue,
      paidInr: 0,
      isActive: true,
      status: 'ACTIVE',
      currentCycleEndsAt: null,
    };
  }

  if (isPaidThrough) {
    return {
      dueInr: 0,
      paidInr: fullDue,
      isActive: true,
      status: 'ACTIVE',
      currentCycleEndsAt: paidUntil!.toISOString(),
    };
  }

  return {
    dueInr: fullDue,
    paidInr: 0,
    isActive: false,
    status: 'PAST_DUE',
    currentCycleEndsAt: null,
  };
}

export function commissionDueAndCycle(input: {
  calculatedDueInr: number;
  monthKey: string;
  periodEndsAt: Date;
  paidForMonthKey: string | null;
  paidInr: number;
  isTrial: boolean;
}): Pick<SubscriptionView, 'dueInr' | 'paidInr' | 'isActive' | 'status' | 'currentMonthKey' | 'currentCycleEndsAt'> {
  const calculated = Math.max(0, Math.round(input.calculatedDueInr));
  const paidForThisMonth = input.paidForMonthKey === input.monthKey;
  const paidInr = paidForThisMonth ? Math.max(0, Number(input.paidInr) || 0) : 0;
  const remainingDue = Math.max(0, calculated - paidInr);

  if (input.isTrial) {
    return {
      dueInr: calculated > 0 ? Math.max(0, calculated - paidInr) : 0,
      paidInr,
      isActive: true,
      status: 'ACTIVE',
      currentMonthKey: calculated > 0 ? input.monthKey : null,
      currentCycleEndsAt: calculated > 0 ? input.periodEndsAt.toISOString() : null,
    };
  }

  const isActive = remainingDue === 0;
  return {
    dueInr: remainingDue,
    paidInr,
    isActive,
    status: isActive ? 'ACTIVE' : 'PAST_DUE',
    currentMonthKey: calculated > 0 ? input.monthKey : null,
    currentCycleEndsAt: calculated > 0 || paidInr > 0 ? input.periodEndsAt.toISOString() : null,
  };
}

class SubscriptionService {
  async getSubscriptionView(businessId: string, now: Date = new Date()): Promise<SubscriptionView> {
    const business = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: {
        id: true,
        timezone: true,
        createdAt: true,
        subscriptionPlan: true,
        subscriptionCommissionPercent: true,
        subscriptionMonthlyInr: true,
        subscriptionStatus: true,
        subscriptionPaidUntil: true,
        subscriptionCommissionPaidForMonth: true,
        subscriptionCommissionPaidInr: true,
        subscriptionLastPaidAt: true,
      },
    });

    const tz = business.timezone || 'Asia/Kolkata';
    const plan = (business.subscriptionPlan || 'COMMISSION') as SubscriptionPlan;

    // Trial: ACTIVE, never paid, within grace window — booking stays open.
    // Fixed plans may still show due so owners can optionally prepay.
    const trialDays = Math.max(0, Number(process.env.SUBSCRIPTION_TRIAL_DAYS ?? 14));
    const withinTrialWindow =
      !!business.createdAt &&
      now.getTime() <= business.createdAt.getTime() + trialDays * 24 * 60 * 60 * 1000;
    const neverPaidYet =
      !business.subscriptionPaidUntil &&
      !business.subscriptionCommissionPaidForMonth &&
      !business.subscriptionLastPaidAt;
    const isTrial = business.subscriptionStatus === 'ACTIVE' && withinTrialWindow && neverPaidYet;

    if (plan === 'COMMISSION') {
      const monthKey = currentMonthKey(tz, now);
      const { gte, lte } = monthUtcRange(tz, now);
      const bookings = await prisma.booking.findMany({
        where: {
          businessId: business.id,
          date: { gte, lte },
        },
        select: { finalPrice: true, originalPrice: true },
      });

      const commissionPercent = business.subscriptionCommissionPercent ?? 5;
      const sumInr = bookings.reduce((acc, b) => {
        const amount = (b.finalPrice ?? b.originalPrice) ?? 0;
        return acc + (Number.isFinite(amount) ? amount : 0);
      }, 0);
      const calculatedDueInr = Math.max(0, Math.round((sumInr * commissionPercent) / 100));

      const computed = commissionDueAndCycle({
        calculatedDueInr,
        monthKey,
        periodEndsAt: lte,
        paidForMonthKey: business.subscriptionCommissionPaidForMonth,
        paidInr: Number(business.subscriptionCommissionPaidInr ?? 0),
        isTrial,
      });

      return {
        plan,
        ...computed,
      };
    }

    // MONTHLY_799 / YEARLY_799
    const monthly = Number(business.subscriptionMonthlyInr ?? 799);
    const paidUntil = business.subscriptionPaidUntil ? new Date(business.subscriptionPaidUntil) : null;
    const computed = fixedPlanDueAndCycle({
      plan,
      monthlyInr: monthly,
      paidUntil,
      now,
      isTrial,
    });

    return {
      plan,
      currentMonthKey: null,
      ...computed,
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

  async markPaid(businessId: string, now: Date = new Date()): Promise<{
    dueInr: number;
    plan: SubscriptionPlan;
    currentCycleEndsAt: string | null;
  }> {
    const view = await this.getSubscriptionView(businessId, now);
    const plan = view.plan;

    if (plan === 'COMMISSION') {
      if (!view.currentMonthKey) {
        await prisma.business.update({
          where: { id: businessId },
          data: { subscriptionStatus: 'ACTIVE' },
        });
        return { dueInr: 0, plan, currentCycleEndsAt: view.currentCycleEndsAt };
      }

      // Pay remaining commission for this month (supports top-up if bookings grew).
      const business = await prisma.business.findUniqueOrThrow({
        where: { id: businessId },
        select: {
          subscriptionCommissionPaidForMonth: true,
          subscriptionCommissionPaidInr: true,
          timezone: true,
        },
      });
      const tz = business.timezone || 'Asia/Kolkata';
      const monthKey = view.currentMonthKey;
      const alreadyPaid =
        business.subscriptionCommissionPaidForMonth === monthKey
          ? Number(business.subscriptionCommissionPaidInr ?? 0)
          : 0;
      const newPaidInr = alreadyPaid + view.dueInr;

      await prisma.business.update({
        where: { id: businessId },
        data: {
          subscriptionCommissionPaidForMonth: monthKey,
          subscriptionCommissionPaidInr: newPaidInr,
          subscriptionLastPaidAt: now,
          subscriptionStatus: 'ACTIVE',
        },
      });

      const { lte } = monthUtcRange(tz, now);
      return { dueInr: view.dueInr, plan, currentCycleEndsAt: lte.toISOString() };
    }

    const monthly = Number(
      (await prisma.business.findUnique({
        where: { id: businessId },
        select: { subscriptionMonthlyInr: true },
      }))?.subscriptionMonthlyInr ?? 799,
    );
    const months = plan === 'YEARLY_799' ? 12 : 1;
    const existing = await prisma.business.findUnique({
      where: { id: businessId },
      select: { subscriptionPaidUntil: true },
    });
    const existingUntil = existing?.subscriptionPaidUntil
      ? new Date(existing.subscriptionPaidUntil)
      : null;
    // Renew from remaining paid-through date when still active; otherwise from now.
    const base =
      existingUntil && existingUntil.getTime() > now.getTime() ? existingUntil : now;
    const paidUntil = addMonthsUtc(base, months);

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

    return { dueInr: view.dueInr, plan, currentCycleEndsAt: paidUntil.toISOString() };
  }

  async isActiveOrThrow(identifier: string): Promise<boolean> {
    // Left intentionally unused in routes for now.
    return identifier ? true : false;
  }
}

export const subscriptionService = new SubscriptionService();
