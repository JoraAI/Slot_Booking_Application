import { AttendanceStatus } from '@prisma/client';
import prisma from '../lib/prisma';
import { timeService } from './TimeService';
import { invoiceCollectedAmount, netCollectedAmount } from './analyticsCollected';

const ATTENDANCE_STATUSES = ['PRESENT', 'HALF_DAY', 'ABSENT', 'LEAVE'] as const;
export type AttendanceStatusValue = (typeof ATTENDANCE_STATUSES)[number];

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

function parseMonth(month: string): { year: number; month: number; from: string; to: string } {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    const err: any = new Error('month must be YYYY-MM');
    err.status = 400;
    throw err;
  }
  const [y, m] = month.split('-').map(Number);
  if (m < 1 || m > 12) {
    const err: any = new Error('Invalid month');
    err.status = 400;
    throw err;
  }
  const last = daysInMonth(y, m);
  return {
    year: y,
    month: m,
    from: `${y}-${pad2(m)}-01`,
    to: `${y}-${pad2(m)}-${pad2(last)}`,
  };
}

class AttendanceService {
  isValidStatus(status: string): status is AttendanceStatusValue {
    return (ATTENDANCE_STATUSES as readonly string[]).includes(status);
  }

  /**
   * Count calendar days in [from,to] whose weekday is an open business day.
   * Falls back to Mon–Sat when no WorkingHour rows exist.
   */
  async workingDaysInRange(businessId: string, fromStr: string, toStr: string): Promise<{
    workingDays: number;
    openWeekdays: number[];
  }> {
    const hours = await prisma.workingHour.findMany({
      where: { businessId },
      select: { dayOfWeek: true, isOpen: true },
    });
    let openWeekdays: number[];
    if (hours.length === 0) {
      openWeekdays = [1, 2, 3, 4, 5, 6]; // Mon–Sat
    } else {
      openWeekdays = [...new Set(hours.filter((h) => h.isOpen).map((h) => h.dayOfWeek))];
    }

    const [fy, fm, fd] = fromStr.split('-').map(Number);
    const [ty, tm, td] = toStr.split('-').map(Number);
    let workingDays = 0;
    const cursor = Date.UTC(fy, fm - 1, fd);
    const end = Date.UTC(ty, tm - 1, td);
    for (let t = cursor; t <= end; t += 24 * 60 * 60 * 1000) {
      const dow = new Date(t).getUTCDay();
      if (openWeekdays.includes(dow)) workingDays += 1;
    }
    return { workingDays, openWeekdays };
  }

  async list(businessId: string, fromStr: string, toStr: string) {
    if (!timeService.isValidDate(fromStr) || !timeService.isValidDate(toStr)) {
      const err: any = new Error('from and to must be YYYY-MM-DD');
      err.status = 400;
      throw err;
    }
    const from = timeService.dateToUtcMidnight(fromStr);
    const to = timeService.dateToUtcMidnight(toStr);
    const [staff, rows, openMeta] = await Promise.all([
      prisma.staff.findMany({
        where: { businessId, isActive: true },
        select: {
          id: true,
          name: true,
          role: true,
          color: true,
          salary: true,
          commissionPercent: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.staffAttendance.findMany({
        where: { businessId, date: { gte: from, lte: to } },
        orderBy: [{ date: 'asc' }, { staffId: 'asc' }],
      }),
      this.workingDaysInRange(businessId, fromStr, toStr),
    ]);

    return {
      from: fromStr,
      to: toStr,
      openWeekdays: openMeta.openWeekdays,
      workingDaysInRange: openMeta.workingDays,
      staff,
      attendances: rows.map((r) => ({
        id: r.id,
        staffId: r.staffId,
        date: timeService.toDateStr(r.date, 'UTC'),
        status: r.status,
        note: r.note,
      })),
    };
  }

  async upsert(
    businessId: string,
    input: { staffId: string; date: string; status: AttendanceStatusValue | null; note?: string | null }
  ) {
    if (!timeService.isValidDate(input.date)) {
      const err: any = new Error('date must be YYYY-MM-DD');
      err.status = 400;
      throw err;
    }
    const staff = await prisma.staff.findFirst({
      where: { id: input.staffId, businessId },
      select: { id: true },
    });
    if (!staff) {
      const err: any = new Error('Staff member not found');
      err.status = 404;
      throw err;
    }

    const date = timeService.dateToUtcMidnight(input.date);

    if (input.status === null) {
      await prisma.staffAttendance.deleteMany({
        where: { businessId, staffId: input.staffId, date },
      });
      return { staffId: input.staffId, date: input.date, status: null, note: null };
    }

    if (!this.isValidStatus(input.status)) {
      const err: any = new Error('Invalid attendance status');
      err.status = 400;
      throw err;
    }

    const note =
      input.note === undefined
        ? undefined
        : input.note === null || String(input.note).trim() === ''
          ? null
          : String(input.note).trim().slice(0, 200);

    const row = await prisma.staffAttendance.upsert({
      where: {
        businessId_staffId_date: { businessId, staffId: input.staffId, date },
      },
      create: {
        businessId,
        staffId: input.staffId,
        date,
        status: input.status as AttendanceStatus,
        note: note ?? null,
      },
      update: {
        status: input.status as AttendanceStatus,
        ...(note !== undefined ? { note } : {}),
      },
    });

    return {
      id: row.id,
      staffId: row.staffId,
      date: input.date,
      status: row.status,
      note: row.note,
    };
  }

  async bulk(
    businessId: string,
    input: { date: string; status: AttendanceStatusValue; staffIds?: string[] }
  ) {
    if (!timeService.isValidDate(input.date)) {
      const err: any = new Error('date must be YYYY-MM-DD');
      err.status = 400;
      throw err;
    }
    if (!this.isValidStatus(input.status)) {
      const err: any = new Error('Invalid attendance status');
      err.status = 400;
      throw err;
    }

    const staffWhere: any = { businessId, isActive: true };
    if (input.staffIds && input.staffIds.length > 0) {
      staffWhere.id = { in: input.staffIds };
    }
    const staff = await prisma.staff.findMany({
      where: staffWhere,
      select: { id: true },
    });
    if (staff.length === 0) {
      return { updated: 0, date: input.date, status: input.status };
    }

    const date = timeService.dateToUtcMidnight(input.date);
    await prisma.$transaction(
      staff.map((s) =>
        prisma.staffAttendance.upsert({
          where: {
            businessId_staffId_date: { businessId, staffId: s.id, date },
          },
          create: {
            businessId,
            staffId: s.id,
            date,
            status: input.status as AttendanceStatus,
          },
          update: { status: input.status as AttendanceStatus },
        })
      )
    );

    return { updated: staff.length, date: input.date, status: input.status };
  }

  async summary(businessId: string, month: string) {
    const { from, to, year, month: monthNum } = parseMonth(month);
    const fromDate = timeService.dateToUtcMidnight(from);
    const toDate = new Date(Date.UTC(year, monthNum - 1, daysInMonth(year, monthNum), 23, 59, 59));

    const [staff, attendances, { workingDays, openWeekdays }] = await Promise.all([
      prisma.staff.findMany({
        where: { businessId, isActive: true },
        select: {
          id: true,
          name: true,
          role: true,
          color: true,
          salary: true,
          commissionPercent: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.staffAttendance.findMany({
        where: { businessId, date: { gte: fromDate, lte: toDate } },
      }),
      this.workingDaysInRange(businessId, from, to),
    ]);

    const countsByStaff: Record<
      string,
      { present: number; halfDay: number; absent: number; leave: number }
    > = {};
    for (const s of staff) {
      countsByStaff[s.id] = { present: 0, halfDay: 0, absent: 0, leave: 0 };
    }
    for (const a of attendances) {
      const c = countsByStaff[a.staffId];
      if (!c) continue;
      if (a.status === 'PRESENT') c.present += 1;
      else if (a.status === 'HALF_DAY') c.halfDay += 1;
      else if (a.status === 'ABSENT') c.absent += 1;
      else if (a.status === 'LEAVE') c.leave += 1;
    }

    // Performance: booking counts + collections (same ideas as Analytics)
    const baseFilter = {
      businessId,
      date: { gte: fromDate, lte: toDate },
    };
    const invoiceSelect = {
      staffId: true,
      source: true,
      total: true,
      booking: {
        select: {
          staffId: true,
          status: true,
          paymentStatus: true,
          paymentAmount: true,
        },
      },
    } as const;

    const [bookingRows, bookingInvoices, walkInInvoices] = await Promise.all([
      prisma.booking.findMany({
        where: baseFilter,
        select: {
          staffId: true,
          status: true,
          paymentStatus: true,
          paymentAmount: true,
        },
      }),
      prisma.invoice.findMany({
        where: {
          businessId,
          source: 'booking_completed',
          booking: { date: { gte: fromDate, lte: toDate } },
        },
        select: invoiceSelect,
      }),
      prisma.invoice.findMany({
        where: {
          businessId,
          source: { in: ['walk_in', 'manual'] },
          issuedAt: { gte: fromDate, lte: toDate },
          staffId: { not: null },
        },
        select: invoiceSelect,
      }),
    ]);

    const perfByStaff: Record<
      string,
      { totalBookings: number; completed: number; cancelled: number; noShow: number; collected: number }
    > = {};
    for (const s of staff) {
      perfByStaff[s.id] = {
        totalBookings: 0,
        completed: 0,
        cancelled: 0,
        noShow: 0,
        collected: 0,
      };
    }
    for (const b of bookingRows) {
      if (!b.staffId || !perfByStaff[b.staffId]) continue;
      const p = perfByStaff[b.staffId];
      p.totalBookings += 1;
      if (b.status === 'COMPLETED') p.completed += 1;
      if (b.status === 'CANCELLED') p.cancelled += 1;
      if (b.status === 'NO_SHOW') p.noShow += 1;
      p.collected += netCollectedAmount(b);
    }
    for (const inv of [...bookingInvoices, ...walkInInvoices]) {
      const sid = inv.staffId || inv.booking?.staffId;
      if (!sid || !perfByStaff[sid]) continue;
      perfByStaff[sid].collected += invoiceCollectedAmount(inv as any);
    }

    const staffSummaries = staff.map((s) => {
      const c = countsByStaff[s.id];
      const earnedUnits = c.present + 0.5 * c.halfDay;
      const salary = s.salary != null ? Number(s.salary) : null;
      const estimatedPayable =
        salary != null && workingDays > 0
          ? round2((earnedUnits * salary) / workingDays)
          : null;
      const perf = perfByStaff[s.id];
      const pct = s.commissionPercent != null ? Number(s.commissionPercent) : 0;
      const collected = round2(perf.collected);
      return {
        id: s.id,
        name: s.name,
        role: s.role,
        color: s.color,
        salary,
        commissionPercent: s.commissionPercent,
        presentDays: c.present,
        halfDays: c.halfDay,
        absentDays: c.absent,
        leaveDays: c.leave,
        earnedUnits,
        workingDaysInMonth: workingDays,
        estimatedPayable,
        totalBookings: perf.totalBookings,
        completedBookings: perf.completed,
        cancelledBookings: perf.cancelled,
        noShowBookings: perf.noShow,
        completionRate:
          perf.totalBookings > 0
            ? Math.round((perf.completed / perf.totalBookings) * 10000) / 100
            : 0,
        collected,
        commissionEarned: round2((collected * pct) / 100),
      };
    });

    return {
      month,
      from,
      to,
      workingDaysInMonth: workingDays,
      openWeekdays,
      staff: staffSummaries,
    };
  }
}

export const attendanceService = new AttendanceService();
