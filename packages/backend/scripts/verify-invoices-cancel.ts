/**
 * Smoke test for allowCustomerCancel + invoice flows.
 * Run: npx tsx --env-file=.env scripts/verify-invoices-cancel.ts
 */
import prisma from '../src/lib/prisma';
import { invoiceService } from '../src/services/InvoiceService';
import { bookingManagementService } from '../src/services/BookingManagementService';

async function main() {
  const business = await prisma.business.findFirst({
    orderBy: { createdAt: 'asc' },
    include: { services: { where: { isActive: true }, take: 1 } },
  });
  if (!business) throw new Error('No business found');

  console.log('Business:', business.name, business.id);

  // 1) allowCustomerCancel field exists and defaults true
  const cancelFlag = business.allowCustomerCancel;
  console.log('allowCustomerCancel:', cancelFlag);
  if (typeof cancelFlag !== 'boolean') throw new Error('allowCustomerCancel missing');

  // 2) Toggle off and verify customer view reflects it
  await prisma.business.update({
    where: { id: business.id },
    data: { allowCustomerCancel: false },
  });
  const booking = await prisma.booking.findFirst({
    where: { businessId: business.id, status: 'CONFIRMED' },
    include: { staff: true, business: true },
  });
  if (!booking) {
    console.log('No confirmed booking — skipping customer view check');
  } else {
    const view = bookingManagementService.customerBookingView({
      ...booking,
      business: { ...business, allowCustomerCancel: false },
    });
    if (view.allowCustomerCancel !== false) throw new Error('customer view should expose allowCustomerCancel=false');
    console.log('customerBookingView.allowCustomerCancel:', view.allowCustomerCancel);
  }
  await prisma.business.update({
    where: { id: business.id },
    data: { allowCustomerCancel: true },
  });

  // 3) Walk-in invoice creation
  const walkIn = await invoiceService.createWalkInInvoice(business.id, {
    customerName: 'Verify Walk-in',
    customerPhone: '+919999999999',
    lineItems: [{ description: 'Verification service', quantity: 1, unitPrice: 100, amount: 100 }],
    paymentMethod: 'cash',
    notes: 'verify script',
  });
  console.log('Walk-in invoice:', walkIn.invoiceNumber, 'total', walkIn.total);

  const html = invoiceService.renderInvoiceHtml(walkIn, business);
  if (!html.includes(walkIn.invoiceNumber) || !html.includes('Verify Walk-in')) {
    throw new Error('Invoice HTML missing expected content');
  }
  console.log('Invoice HTML length:', html.length);

  // 4) Paid booking invoice (if any paid booking exists)
  const paidBooking = await prisma.booking.findFirst({
    where: {
      businessId: business.id,
      paymentStatus: { in: ['paid', 'partial'] },
      paymentAmount: { gt: 0 },
    },
    include: { staff: true },
  });
  if (paidBooking) {
    const paidInv = await invoiceService.getOrCreatePaidBookingInvoice(business.id, paidBooking.id);
    console.log('Paid booking invoice:', paidInv.invoiceNumber, 'booking', paidBooking.id);
    const again = await invoiceService.getOrCreatePaidBookingInvoice(business.id, paidBooking.id);
    if (again.id !== paidInv.id) throw new Error('Paid invoice should be idempotent');
    console.log('Paid invoice idempotent: ok');
  } else {
    console.log('No paid booking found — skipping paid invoice check');
  }

  // 5) Completed unpaid booking invoice
  const completed = await prisma.booking.findFirst({
    where: {
      businessId: business.id,
      status: 'COMPLETED',
      OR: [{ paymentStatus: null }, { paymentStatus: 'pending' }],
      invoice: null,
    },
  });
  if (completed) {
    const inv = await invoiceService.createFromCompletedBooking(business.id, completed.id, {
      amount: completed.finalPrice ?? completed.originalPrice ?? 500,
      paymentMethod: 'cash',
    });
    console.log('Completed booking invoice:', inv.invoiceNumber);
  } else {
    console.log('No eligible completed unpaid booking — skipping');
  }

  // Cleanup walk-in test invoice only (keep real invoices if created from existing bookings)
  await prisma.invoice.delete({ where: { id: walkIn.id } });
  console.log('Cleaned up walk-in test invoice');

  console.log('\n✅ Verification passed');
}

main()
  .catch((e) => {
    console.error('\n❌ Verification failed:', e.message || e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
