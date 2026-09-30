import assert from 'node:assert/strict';
import test from 'node:test';
import { invoiceService } from './InvoiceService';

const inv = {
  invoiceNumber: 'INV-TEST',
  issuedAt: new Date(),
  customerName: 'Ada',
  customerPhone: '+91',
  customerEmail: null,
  subtotal: 100,
  taxAmount: 0,
  total: 100,
  currency: 'INR',
  items: [{ description: 'Haircut', quantity: 1, unitPrice: 100, amount: 100 }],
  paymentMethod: null,
  notes: null,
  cgstAmount: 0,
  sgstAmount: 0,
  igstAmount: 0,
  discountAmount: 0,
  staffName: null,
  staffId: null,
  booking: null,
};

const biz = {
  id: 'b1',
  name: 'Demo',
  address: 'x',
  ownerEmail: 'o@x.com',
  logoUrl: null,
  timezone: 'Asia/Kolkata',
};

test('INV-CTA-1. No CTA when googleReviewUrl missing', () => {
  for (const url of [null, '', '   ']) {
    const html = invoiceService.renderInvoiceHtml(inv, { ...biz, googleReviewUrl: url });
    assert.equal(html.includes('Leave a Google review'), false);
  }
});

test('INV-CTA-2. CTA when googleReviewUrl set', () => {
  const html = invoiceService.renderInvoiceHtml(inv, {
    ...biz,
    googleReviewUrl: 'https://g.page/r/AbCd/review',
  });
  assert.equal(html.includes('Leave a Google review'), true);
  assert.equal(html.includes('https://g.page/r/AbCd/review'), true);
});
