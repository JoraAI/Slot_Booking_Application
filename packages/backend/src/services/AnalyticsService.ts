import prisma from '../lib/prisma';
import { timeService } from './TimeService';
import { netCollectedAmount } from './analyticsCollected';

class AnalyticsService {
  async getAnalytics(businessId: string, dateFrom: string, dateTo: string, staffId?: string) {
    const from = new Date(dateFrom + 'T00:00:00Z');
    const to = new Date(dateTo + 'T23:59:59Z');

    const baseFilter: any = {
      businessId,
      date: { gte: from, lte: to },
    };
    if (staffId) baseFilter.staffId = staffId;

    // Total bookings
    const [totalBookings, confirmedBookings, cancelledBookings, completedBookings, noShowBookings] = await Promise.all([
      prisma.booking.count({ where: baseFilter }),
      prisma.booking.count({ where: { ...baseFilter, status: 'CONFIRMED' } }),
      prisma.booking.count({ where: { ...baseFilter, status: 'CANCELLED' } }),
      prisma.booking.count({ where: { ...baseFilter, status: 'COMPLETED' } }),
      prisma.booking.count({ where: { ...baseFilter, status: 'NO_SHOW' } }),
    ]);

    // Cancellation rate
    const cancellationRate = totalBookings > 0
      ? Math.round((cancelledBookings / totalBookings) * 100 * 100) / 100
      : 0;

    // Peak hour
    const peakHourData = await prisma.booking.findMany({
      where: baseFilter,
      select: { startTime: true },
    });
    const hourCounts: Record<string, number> = {};
    peakHourData.forEach(b => {
      hourCounts[b.startTime] = (hourCounts[b.startTime] || 0) + 1;
    });
    const peakHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

    // Busiest day
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const bookingsWithDates = await prisma.booking.findMany({
      where: baseFilter,
      select: { date: true },
    });
    const dayCounts: Record<string, number> = {};
    bookingsWithDates.forEach(b => {
      const day = dayNames[new Date(b.date).getDay()];
      dayCounts[day] = (dayCounts[day] || 0) + 1;
    });
    const busiestDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

    // Booking heatmap (day of week × hour)
    const heatmap: Record<string, Record<string, number>> = {};
    const allBookings = await prisma.booking.findMany({
      where: baseFilter,
      select: { date: true, startTime: true },
    });
    allBookings.forEach(b => {
      const day = dayNames[new Date(b.date).getDay()];
      if (!heatmap[day]) heatmap[day] = {};
      heatmap[day][b.startTime] = (heatmap[day][b.startTime] || 0) + 1;
    });

    // Trend line (bookings per day)
    const trendData = await prisma.booking.findMany({
      where: baseFilter,
      select: { date: true },
    });
    const trend: Record<string, number> = {};
    trendData.forEach(b => {
      const d = timeService.toDateStr(b.date, 'UTC');
      trend[d] = (trend[d] || 0) + 1;
    });

    // Status breakdown
    const statusBreakdown = {
      confirmed: confirmedBookings,
      completed: completedBookings,
      cancelled: cancelledBookings,
      noShow: noShowBookings,
    };

    // Sparkline data (last 7 days)
    const sparkline: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(to);
      d.setDate(d.getDate() - i);
      const dateStr = timeService.toDateStr(d, 'UTC');
      sparkline.push(trend[dateStr] || 0);
    }

    // Previous period for comparison
    const periodDays = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
    const prevFrom = new Date(from);
    prevFrom.setDate(prevFrom.getDate() - periodDays);
    const prevTo = new Date(from);
    prevTo.setDate(prevTo.getDate() - 1);

    const prevTotalBookings = await prisma.booking.count({
      where: { ...baseFilter, date: { gte: prevFrom, lte: prevTo } },
    });

    // Revenue data (if payments enabled)
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { enablePayments: true },
    });

    let revenue: any = null;
    if (business?.enablePayments) {
      const paidBookings = await prisma.booking.findMany({
        where: {
          ...baseFilter,
          status: { not: 'CANCELLED' },
          paymentStatus: { in: ['paid', 'partial'] },
        },
        select: { paymentAmount: true, createdAt: true, paymentStatus: true },
      });

      const totalRevenue = paidBookings.reduce((sum, b) => sum + netCollectedAmount({
        status: 'CONFIRMED',
        paymentStatus: b.paymentStatus,
        paymentAmount: b.paymentAmount,
      }), 0);

      const refundedBookings = await prisma.booking.findMany({
        where: { ...baseFilter, paymentStatus: 'refunded' },
        select: { paymentAmount: true },
      });
      const totalRefunded = refundedBookings.reduce((sum, b) => sum + (b.paymentAmount || 0), 0);

      const failedPayments = await prisma.booking.count({
        where: { ...baseFilter, paymentStatus: 'pending' },
      });

      // Revenue by day
      const revenueByDay: Record<string, number> = {};
      paidBookings.forEach(b => {
        const d = timeService.toDateStr(b.createdAt, 'UTC');
        revenueByDay[d] = (revenueByDay[d] || 0) + (b.paymentAmount || 0);
      });

      revenue = {
        totalRevenue,
        totalRefunded,
        refundCount: refundedBookings.length,
        failureRate: paidBookings.length > 0
          ? Math.round((failedPayments / (paidBookings.length + failedPayments)) * 10000) / 100
          : 0,
        revenueByDay,
      };
    }

    // Waitlist data (if enabled)
    let waitlist: any = null;
    if (business) {
      const businessFull = await prisma.business.findUnique({
        where: { id: businessId },
        select: { enableWaitlist: true },
      });
      if (businessFull?.enableWaitlist) {
        const totalWaitlist = await prisma.waitlistEntry.count({
          where: {
            businessId,
            createdAt: { gte: from, lte: to },
          },
        });
        const notifiedWaitlist = await prisma.waitlistEntry.count({
          where: {
            businessId,
            notified: true,
            expired: false,
            createdAt: { gte: from, lte: to },
          },
        });

        waitlist = {
          totalEntries: totalWaitlist,
          conversionRate: totalWaitlist > 0
            ? Math.round((notifiedWaitlist / totalWaitlist) * 10000) / 100
            : 0,
        };
      }
    }

    // Recurring data
    let recurring: any = null;
    const businessRecurring = await prisma.business.findUnique({
      where: { id: businessId },
      select: { enableRecurring: true },
    });
    if (businessRecurring?.enableRecurring) {
      const recurringBookings = await prisma.booking.count({
        where: { ...baseFilter, isRecurring: true },
      });

      const uniqueGroups = await prisma.booking.findMany({
        where: { ...baseFilter, isRecurring: true, recurringGroupId: { not: null } },
        select: { recurringGroupId: true },
        distinct: ['recurringGroupId'],
      });

      recurring = {
        percentage: totalBookings > 0
          ? Math.round((recurringBookings / totalBookings) * 10000) / 100
          : 0,
        activeSeries: uniqueGroups.length,
      };
    }

    // Staff performance
    let staffPerformance: any = null;
    const businessStaff = await prisma.business.findUnique({
      where: { id: businessId },
      select: { enableMultiStaff: true },
    });
    if (businessStaff?.enableMultiStaff) {
      const staffMembers = await prisma.staff.findMany({
        where: { businessId, isActive: true },
      });

      const staffStats = await Promise.all(
        staffMembers.map(async (s) => {
          const [total, completed, cancelled, noShow] = await Promise.all([
            prisma.booking.count({ where: { ...baseFilter, staffId: s.id } }),
            prisma.booking.count({ where: { ...baseFilter, staffId: s.id, status: 'COMPLETED' } }),
            prisma.booking.count({ where: { ...baseFilter, staffId: s.id, status: 'CANCELLED' } }),
            prisma.booking.count({ where: { ...baseFilter, staffId: s.id, status: 'NO_SHOW' } }),
          ]);

          return {
            id: s.id,
            name: s.name,
            role: s.role,
            color: s.color,
            totalBookings: total,
            completionRate: total > 0 ? Math.round((completed / total) * 10000) / 100 : 0,
            noShowRate: total > 0 ? Math.round((noShow / total) * 10000) / 100 : 0,
            cancellationRate: total > 0 ? Math.round((cancelled / total) * 10000) / 100 : 0,
          };
        })
      );

      staffPerformance = staffStats;
    }

    // Revenue metrics
    const revenueRows = await prisma.booking.findMany({
      where: baseFilter,
      select: {
        status: true,
        finalPrice: true,
        originalPrice: true,
        discountAmount: true,
        paymentStatus: true,
        paymentAmount: true,
        source: true,
        serviceId: true,
        serviceNameSnapshot: true,
        durationMinutesSnapshot: true,
      },
    });

    const totalCollected = revenueRows.reduce((sum, b) => sum + netCollectedAmount(b), 0);
    const activeRows = revenueRows.filter(b => b.status !== 'CANCELLED');
    const totalListed = activeRows.reduce((sum, b) => sum + (b.originalPrice || 0), 0);
    const discountsGiven = activeRows.reduce((sum, b) => sum + (b.discountAmount || 0), 0);
    const avgBookingValue = activeRows.length > 0
      ? Math.round((totalCollected / activeRows.length) * 100) / 100
      : 0;
    const discountUsageCount = activeRows.filter(b => (b.discountAmount || 0) > 0).length;

    // Bookings by service (legacy rows appear under "Legacy/Unassigned")
    const byServiceMap: Record<string, { name: string; count: number; revenue: number }> = {};
    revenueRows.forEach(b => {
      const key = b.serviceId || '__legacy__';
      if (!byServiceMap[key]) {
        byServiceMap[key] = { name: b.serviceNameSnapshot || 'Legacy/Unassigned', count: 0, revenue: 0 };
      }
      byServiceMap[key].count += 1;
      byServiceMap[key].revenue += netCollectedAmount(b);
    });
    const bookingsByService = Object.values(byServiceMap).sort((a, b) => b.count - a.count);

    // Revenue by service (reuse byServiceMap, filter zero-revenue rows out later)
    const revenueByService = Object.values(byServiceMap)
      .map(s => ({ name: s.name, revenue: Math.round(s.revenue * 100) / 100 }))
      .sort((a, b) => b.revenue - a.revenue);

    // Popular services = bookingsByService order (already sorted by count)
    const popularServices = bookingsByService.slice(0, 5).map(s => ({ name: s.name, bookings: s.count }));

    // Bookings by category (join service -> category snapshot at query time)
    const categoryRows = revenueRows.length > 0
      ? await prisma.booking.findMany({
          where: baseFilter,
          select: { service: { select: { category: { select: { name: true } } } } },
        })
      : [];
    const byCategoryMap: Record<string, number> = {};
    categoryRows.forEach(b => {
      const name = b.service?.category?.name || 'Legacy/Unassigned';
      byCategoryMap[name] = (byCategoryMap[name] || 0) + 1;
    });
    const bookingsByCategory = Object.entries(byCategoryMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // Bookings by source
    const bySourceMap: Record<string, number> = {};
    revenueRows.forEach(b => {
      const source = b.source || 'DIRECT';
      bySourceMap[source] = (bySourceMap[source] || 0) + 1;
    });
    const bookingsBySource = Object.entries(bySourceMap)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);
    const qrBookingCount = bySourceMap['QR'] || 0;
    const qrBookingRate = totalBookings > 0 ? Math.round((qrBookingCount / totalBookings) * 10000) / 100 : 0;

    return {
      totalBookings,
      cancellationRate,
      peakHour,
      busiestDay,
      heatmap,
      trend,
      sparkline,
      statusBreakdown,
      prevTotalBookings,
      revenue,
      waitlist,
      recurring,
      staffPerformance,
      // New v4 analytics
      revenueMetrics: {
        totalCollected: Math.round(totalCollected * 100) / 100,
        totalListed: Math.round(totalListed * 100) / 100,
        discountsGiven: Math.round(discountsGiven * 100) / 100,
        avgBookingValue,
        discountUsageCount,
      },
      bookingsByService,
      revenueByService,
      bookingsByCategory,
      bookingsBySource,
      qrBooking: {
        count: qrBookingCount,
        rate: qrBookingRate,
      },
      popularServices,
      avgBookingValue,
    };
  }
}

export const analyticsService = new AnalyticsService();