/**
 * HTTP-level verify for cancel gate + invoice routes.
 * Run: npx tsx --env-file=.env scripts/verify-invoices-cancel-http.ts
 */
import express from 'express';
import { publicRouter } from '../src/routes/public';
import { ownerRouter } from '../src/routes/owner';
import prisma from '../src/lib/prisma';
import { bookingManagementService } from '../src/services/BookingManagementService';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

async function listen(app: express.Express): Promise<{ base: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        base: `http://127.0.0.1:${port}/api`,
        close: () => server.close(),
      });
    });
  });
}

async function main() {
  const app = express();
  app.use(express.json());
  app.use('/api', publicRouter);
  app.use('/api/owner', ownerRouter);
  const { base, close } = await listen(app);

  const business = await prisma.business.findFirst({
    where: { slug: { contains: 'demo' } },
    orderBy: { createdAt: 'asc' },
  });
  if (!business) throw new Error('Demo business not found');

  const booking = await prisma.booking.findFirst({
    where: { businessId: business.id, status: 'CONFIRMED' },
  });
  if (!booking) throw new Error('No confirmed booking for HTTP test');

  const fresh = bookingManagementService.generateToken();
  await prisma.booking.update({
    where: { id: booking.id },
    data: { managementTokenHash: fresh.hash },
  });

  // Session
  const sessionRes = await fetch(`${base}/${business.publicCode}/bookings/${booking.id}/manage/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: fresh.token }),
  });
  const sessionBody = await sessionRes.json() as any;
  if (!sessionRes.ok) throw new Error(`session failed: ${sessionBody.error}`);
  if (sessionBody.booking?.allowCustomerCancel !== true) {
    throw new Error(`expected allowCustomerCancel true, got ${sessionBody.booking?.allowCustomerCancel}`);
  }
  console.log('Session exposes allowCustomerCancel:', sessionBody.booking.allowCustomerCancel);

  // Disable cancel
  await prisma.business.update({ where: { id: business.id }, data: { allowCustomerCancel: false } });
  const sessionRes2 = await fetch(`${base}/${business.publicCode}/bookings/${booking.id}/manage/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: fresh.token }),
  });
  const sessionBody2 = await sessionRes2.json() as any;
  if (sessionBody2.booking?.allowCustomerCancel !== false) {
    throw new Error('allowCustomerCancel should be false after toggle');
  }
  console.log('Session after toggle:', sessionBody2.booking.allowCustomerCancel);

  const cancelRes = await fetch(`${base}/${business.publicCode}/bookings/${booking.id}/manage`, {
    method: 'DELETE',
    headers: { 'X-Booking-Session': sessionBody2.sessionToken },
  });
  const cancelBody = await cancelRes.json() as any;
  if (cancelRes.status !== 403) {
    throw new Error(`Expected 403 on cancel when disabled, got ${cancelRes.status}: ${cancelBody.error}`);
  }
  console.log('Cancel blocked with 403:', cancelBody.error);

  await prisma.business.update({ where: { id: business.id }, data: { allowCustomerCancel: true } });

  // Owner invoice routes
  const ownerToken = jwt.sign({ businessId: business.id, email: business.ownerEmail }, JWT_SECRET, { expiresIn: '1h' });
  const walkInRes = await fetch(`${base}/owner/invoices`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ownerToken}`,
    },
    body: JSON.stringify({
      customerName: 'HTTP Verify',
      lineItems: [{ description: 'Test', quantity: 1, unitPrice: 50, amount: 50 }],
      paymentMethod: 'cash',
    }),
  });
  const walkInBody = await walkInRes.json() as any;
  if (!walkInRes.ok) throw new Error(`walk-in invoice failed: ${walkInBody.error}`);
  console.log('Owner walk-in invoice:', walkInBody.invoiceNumber);

  const htmlRes = await fetch(`${base}/owner/invoices/${walkInBody.id}/html`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  const html = await htmlRes.text();
  if (!htmlRes.ok || !html.includes('HTTP Verify')) {
    throw new Error('Owner invoice HTML failed');
  }
  console.log('Owner invoice HTML ok');

  const listRes = await fetch(`${base}/owner/invoices`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  const list = await listRes.json() as any[];
  if (!listRes.ok || !Array.isArray(list) || list.length === 0) {
    throw new Error('Invoice list failed');
  }
  console.log('Invoice list count:', list.length);

  await prisma.invoice.delete({ where: { id: walkInBody.id } });
  close();
  console.log('\n✅ HTTP verification passed');
}

main()
  .catch((e) => {
    console.error('\n❌ HTTP verification failed:', e.message || e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
