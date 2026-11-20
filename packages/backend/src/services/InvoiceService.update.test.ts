import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { invoiceService } from './InvoiceService';

const createdBusinessIds: string[] = [];

async function makeBusiness() {
  const tag = crypto.randomBytes(4).toString('hex');
  const b = await prisma.business.create({
    data: {
      name: `InvEdit ${tag}`,
      slug: `invedit-${tag}`,
      publicCode: crypto.randomBytes(16).toString('base64url'),
      timezone: 'Asia/Kolkata',
      ownerEmail: `invedit-${tag}@test.com`,
      ownerPassword: 'hashed',
      defaultGstPercent: null,
      workingHours: {
        create: Array.from({ length: 7 }, (_, i) => ({
          dayOfWeek: i,
          openTime: '09:00',
          closeTime: '18:00',
          isOpen: true,
        })),
      },
    },
  });
  createdBusinessIds.push(b.id);
  return b;
}

after(async () => {
  for (const id of createdBusinessIds) {
    await prisma.business.delete({ where: { id } }).catch(() => {});
  }
  await prisma.$disconnect();
});

test('updateInvoice bumps service price and keeps invoice number', async () => {
  const business = await makeBusiness();
  const created = await invoiceService.createWalkInInvoice(business.id, {
    customerName: 'Extra Pay Customer',
    customerPhone: '9999999999',
    lineItems: [
      { description: 'Hair Cut', quantity: 1, unitPrice: 500, amount: 500, serviceId: null, productId: null },
    ],
    paymentMethod: 'cash',
  });

  assert.equal(created.total, 500);
  const number = created.invoiceNumber;

  const updated = await invoiceService.updateInvoice(business.id, created.id, {
    customerName: 'Extra Pay Customer',
    customerPhone: '9999999999',
    lineItems: [
      { description: 'Hair Cut', quantity: 1, unitPrice: 800, amount: 800, serviceId: null, productId: null },
    ],
    paymentMethod: 'upi',
    notes: 'Paid extra for styling',
  });

  assert.equal(updated.invoiceNumber, number);
  assert.equal(updated.total, 800);
  assert.equal(updated.subtotal, 800);
  assert.equal(updated.paymentMethod, 'upi');
  assert.equal(updated.notes, 'Paid extra for styling');
  assert.equal(updated.issuedAt.getTime(), created.issuedAt.getTime());
});

test('updateInvoice resyncs product sales and stock', async () => {
  const business = await makeBusiness();
  const product = await prisma.product.create({
    data: {
      businessId: business.id,
      name: 'Serum',
      price: 200,
      stockQty: 10,
      isActive: true,
    },
  });

  const created = await invoiceService.createWalkInInvoice(business.id, {
    customerName: 'Product Buyer',
    lineItems: [
      {
        description: 'Serum',
        quantity: 2,
        unitPrice: 200,
        amount: 400,
        productId: product.id,
      },
    ],
    paymentMethod: 'cash',
  });

  let stock = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert.equal(stock.stockQty, 8);
  const salesAfterCreate = await prisma.productSale.count({ where: { invoiceId: created.id } });
  assert.equal(salesAfterCreate, 1);

  await invoiceService.updateInvoice(business.id, created.id, {
    customerName: 'Product Buyer',
    lineItems: [
      {
        description: 'Serum',
        quantity: 1,
        unitPrice: 200,
        amount: 200,
        productId: product.id,
      },
    ],
    paymentMethod: 'cash',
  });

  stock = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert.equal(stock.stockQty, 9);
  const sales = await prisma.productSale.findMany({ where: { invoiceId: created.id } });
  assert.equal(sales.length, 1);
  assert.equal(sales[0].quantity, 1);
  assert.equal(sales[0].totalAmount, 200);
});

test('toDetail includes lineItems for edit prefill', async () => {
  const business = await makeBusiness();
  const created = await invoiceService.createWalkInInvoice(business.id, {
    customerName: 'Detail Check',
    lineItems: [
      { description: 'Facial', quantity: 1, unitPrice: 1500, amount: 1500 },
    ],
    paymentMethod: 'card',
    notes: 'hello',
  });
  const detail = invoiceService.toDetail(created);
  assert.equal(detail.invoiceNumber, created.invoiceNumber);
  assert.equal(detail.notes, 'hello');
  assert.equal(Array.isArray(detail.lineItems), true);
  assert.equal(detail.lineItems.length, 1);
  assert.equal(detail.lineItems[0].description, 'Facial');
});
