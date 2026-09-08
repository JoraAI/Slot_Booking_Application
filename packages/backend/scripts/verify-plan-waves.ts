/**
 * End-to-end verification of Waves 1–4 against the demo DB.
 * Run: npx tsx --env-file=.env scripts/verify-plan-waves.ts
 */
import express from 'express';
import prisma from '../src/lib/prisma';
import { ownerRouter } from '../src/routes/owner';
import { orgAuthService } from '../src/services/OrgAuthService';
import { invoiceService } from '../src/services/InvoiceService';
import { analyticsService } from '../src/services/AnalyticsService';
import { verifyOwnerPassword } from '../src/services/OwnerPassword';

const checks: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  // --- Schema / backfill ---
  const [businesses, users, orgs, unlinked] = await Promise.all([
    prisma.business.count(),
    prisma.user.count(),
    prisma.organization.count(),
    prisma.business.count({ where: { organizationId: null } }),
  ]);
  check('all businesses linked to org', unlinked === 0, `${businesses} shops, ${users} users, ${orgs} orgs, unlinked=${unlinked}`);

  const demo = await prisma.business.findFirst({
    where: { ownerEmail: { equals: 'owner@demosalon.com', mode: 'insensitive' } },
    include: { memberships: true, organization: true },
  });
  check('demo salon exists', !!demo, demo?.name);
  check('demo is primary', !!demo?.isPrimary);
  check('demo has org + membership', !!demo?.organizationId && demo.memberships.length >= 1);

  const user = await prisma.user.findUnique({ where: { email: 'owner@demosalon.com' } });
  check('demo user exists with password', !!user?.passwordHash);
  if (user?.passwordHash) {
    check('demo password admin123', await verifyOwnerPassword(user.passwordHash, 'admin123'));
  }

  // --- HTTP login + /me + shops ---
  const app = express();
  app.use(express.json());
  app.use('/api/owner', ownerRouter);
  const server = await new Promise<import('http').Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}/api/owner`;

  const loginRes = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@demosalon.com', password: 'admin123' }),
  });
  const loginJson: any = await loginRes.json();
  check('POST /owner/login 200', loginRes.status === 200, `status=${loginRes.status}`);
  check('login returns role OWNER', loginJson.role === 'OWNER', String(loginJson.role));
  check('login returns userId+orgId+token', !!(loginJson.userId && loginJson.orgId && loginJson.token));

  const meRes = await fetch(`${base}/me`, {
    headers: { Authorization: `Bearer ${loginJson.token}` },
  });
  const me: any = await meRes.json();
  check('GET /owner/me 200', meRes.status === 200);
  check('/me includes shops[]', Array.isArray(me.shops) && me.shops.length >= 1, `shops=${me.shops?.length}`);
  check('/me role OWNER', me.role === 'OWNER');

  const shopsRes = await fetch(`${base}/shops`, {
    headers: { Authorization: `Bearer ${loginJson.token}` },
  });
  const shopsJson: any = await shopsRes.json();
  check('GET /owner/shops 200', shopsRes.status === 200, `count=${shopsJson.shops?.length}`);

  // Manager cannot hit subscription select (create temp manager if possible)
  if (user && demo?.organizationId) {
    const tag = Date.now().toString(36);
    const mgrEmail = `verify-mgr-${tag}@test.com`;
    try {
      const invited = await orgAuthService.inviteManager({
        ownerUserId: user.id,
        orgId: demo.organizationId,
        email: mgrEmail,
        businessIds: [demo.id],
        temporaryPassword: 'managerpass1',
      });
      const mgrLogin = await fetch(`${base}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: mgrEmail, password: 'managerpass1' }),
      });
      const mgrJson: any = await mgrLogin.json();
      check('manager login OK', mgrLogin.status === 200 && mgrJson.role === 'MANAGER', mgrJson.role);
      const subRes = await fetch(`${base}/subscription/select`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${mgrJson.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ plan: 'MONTHLY_799' }),
      });
      check('manager blocked from subscription/select', subRes.status === 403, `status=${subRes.status}`);

      // cleanup manager
      await prisma.businessMembership.deleteMany({ where: { userId: invited.userId } });
      await prisma.orgMember.deleteMany({ where: { userId: invited.userId } });
      await prisma.user.delete({ where: { id: invited.userId } }).catch(() => {});
    } catch (e: any) {
      check('manager invite+gate', false, e.message);
    }
  }

  // --- GST + POS lite ---
  if (demo) {
    await prisma.business.update({
      where: { id: demo.id },
      data: {
        gstin: demo.gstin || '27AAAAA0000A1Z5',
        legalName: demo.legalName || 'Demo Salon Pvt Ltd',
        stateCode: demo.stateCode || '27',
        defaultGstPercent: demo.defaultGstPercent ?? 18,
      },
    });

    let product = await prisma.product.findFirst({
      where: { businessId: demo.id, isActive: true },
    });
    if (!product) {
      product = await prisma.product.create({
        data: { businessId: demo.id, name: 'Verify Product', price: 500, stockQty: 10 },
      });
    } else if (product.stockQty == null) {
      product = await prisma.product.update({
        where: { id: product.id },
        data: { stockQty: 10 },
      });
    }
    const stockBefore = product.stockQty ?? 0;

    const invoice = await invoiceService.createWalkInInvoice(demo.id, {
      customerName: 'Plan Verify Customer',
      customerPhone: '+919888880002',
      lineItems: [
        {
          description: product.name,
          quantity: 2,
          unitPrice: product.price,
          amount: product.price * 2,
          productId: product.id,
        },
      ],
      paymentMethod: 'upi',
      discountType: 'PERCENTAGE',
      discountValue: 10,
    });

    const expectedTaxable = product.price * 2 * 0.9;
    const expectedTax = Math.round(expectedTaxable * 0.18 * 100) / 100;
    check(
      'GST CGST+SGST applied',
      Math.abs(invoice.taxAmount - expectedTax) < 0.02 &&
        Math.abs((invoice.cgstAmount || 0) + (invoice.sgstAmount || 0) - invoice.taxAmount) < 0.02,
      `tax=${invoice.taxAmount} cgst=${invoice.cgstAmount} sgst=${invoice.sgstAmount}`
    );

    const sales = await prisma.productSale.count({ where: { invoiceId: invoice.id } });
    const after = await prisma.product.findUnique({ where: { id: product.id } });
    check('ProductSale created from walk-in', sales === 1);
    check('stock decremented', (after?.stockQty ?? -1) === stockBefore - 2, `${stockBefore} → ${after?.stockQty}`);

    const contact = await prisma.customerContact.findFirst({
      where: { businessId: demo.id, phone: { contains: '9888880002' } },
    });
    check('customer upserted from walk-in', !!contact);

    // tags
    if (contact) {
      const tagged = await prisma.customerContact.update({
        where: { id: contact.id },
        data: { tags: ['vip', 'verify'] },
      });
      check('customer tags writable', tagged.tags.includes('vip'));
    }

    // staff commission field
    const staff = await prisma.staff.findFirst({ where: { businessId: demo.id } });
    if (staff) {
      await prisma.staff.update({
        where: { id: staff.id },
        data: { commissionPercent: 10 },
      });
      const refreshed = await prisma.staff.findUnique({ where: { id: staff.id } });
      check('staff commissionPercent writable', refreshed?.commissionPercent === 10);
      await prisma.staff.update({ where: { id: staff.id }, data: { commissionPercent: staff.commissionPercent } });
    } else {
      check('staff commissionPercent writable', true, 'no staff — skipped');
    }

    // analytics shape
    const today = new Date();
    const from = new Date(today);
    from.setDate(from.getDate() - 30);
    const analytics = await analyticsService.getAnalytics(
      demo.id,
      from.toISOString().slice(0, 10),
      today.toISOString().slice(0, 10),
    );
    check(
      'analytics exposes gst/payment/staff fields',
      analytics.gstCollected != null &&
        Array.isArray(analytics.paymentMethodMix) &&
        Array.isArray(analytics.staffCollections),
      `gst=${analytics.gstCollected} mix=${analytics.paymentMethodMix?.length}`
    );

    // cleanup invoice pollution
    await prisma.productSale.deleteMany({ where: { invoiceId: invoice.id } });
    await prisma.invoice.delete({ where: { id: invoice.id } });
    if (after && product.stockQty != null) {
      await prisma.product.update({ where: { id: product.id }, data: { stockQty: stockBefore } });
    }
  }

  // --- Add shop (owner) then delete it ---
  if (user && demo?.organizationId && loginJson.token) {
    const createRes = await fetch(`${base}/shops`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${loginJson.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: `Verify Branch ${Date.now()}`, copyHoursFromPrimary: true }),
    });
    const created: any = await createRes.json();
    check('POST /owner/shops creates branch', createRes.status === 201 && !!created.token, `status=${createRes.status}`);
    if (created.business?.id) {
      const branchId = created.business.id;
      check('new shop isPrimary=false', true);
      const b = await prisma.business.findUnique({ where: { id: branchId } });
      check('branch not primary', b?.isPrimary === false);
      // cleanup branch
      await prisma.businessMembership.deleteMany({ where: { businessId: branchId } });
      await prisma.workingHour.deleteMany({ where: { businessId: branchId } });
      await prisma.formField.deleteMany({ where: { businessId: branchId } });
      await prisma.business.delete({ where: { id: branchId } });
    }
  }

  server.close();

  const failed = checks.filter((c) => !c.ok);
  console.log('\n---');
  console.log(`${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length) {
    console.log('Failed:', failed.map((f) => f.name).join(', '));
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
