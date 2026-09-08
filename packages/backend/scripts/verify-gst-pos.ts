import prisma from '../src/lib/prisma';
import { invoiceService } from '../src/services/InvoiceService';
import { orgAuthService } from '../src/services/OrgAuthService';

async function main() {
  const business = await prisma.business.findFirst({
    where: { ownerEmail: { equals: 'owner@demosalon.com', mode: 'insensitive' } },
  });
  if (!business) throw new Error('demo business missing');

  await prisma.business.update({
    where: { id: business.id },
    data: {
      gstin: '27AAAAA0000A1Z5',
      legalName: 'Demo Salon Pvt Ltd',
      stateCode: '27',
      defaultGstPercent: 18,
    },
  });

  let product = await prisma.product.findFirst({
    where: { businessId: business.id, isActive: true },
  });
  if (!product) {
    product = await prisma.product.create({
      data: {
        businessId: business.id,
        name: 'Verify Serum',
        price: 500,
        stockQty: 10,
        hsnCode: '3304',
      },
    });
  } else if (product.stockQty == null) {
    product = await prisma.product.update({
      where: { id: product.id },
      data: { stockQty: 10 },
    });
  }

  const stockBefore = product.stockQty ?? 0;
  const invoice = await invoiceService.createWalkInInvoice(business.id, {
    customerName: 'GST Verify Customer',
    customerPhone: '+919999990001',
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

  console.log({
    invoiceNumber: invoice.invoiceNumber,
    subtotal: invoice.subtotal,
    discountAmount: invoice.discountAmount,
    taxAmount: invoice.taxAmount,
    cgst: invoice.cgstAmount,
    sgst: invoice.sgstAmount,
    total: invoice.total,
  });

  const sales = await prisma.productSale.findMany({ where: { invoiceId: invoice.id } });
  const after = await prisma.product.findUnique({ where: { id: product.id } });
  const contact = await prisma.customerContact.findFirst({
    where: { businessId: business.id, phone: { contains: '9999990001' } },
  });

  console.log({
    productSales: sales.length,
    stockBefore,
    stockAfter: after?.stockQty,
    customerUpserted: !!contact,
  });

  // Extra shop under same org
  const user = await prisma.user.findUnique({ where: { email: 'owner@demosalon.com' } });
  if (user && business.organizationId) {
    const shopsBefore = await orgAuthService.listShopsForUser(user.id, business.organizationId);
    console.log({ shopsBefore: shopsBefore.length });
  }

  // Cleanup verify invoice/sales to avoid polluting demo
  await prisma.productSale.deleteMany({ where: { invoiceId: invoice.id } });
  await prisma.invoice.delete({ where: { id: invoice.id } });
  if (after && product.stockQty != null) {
    await prisma.product.update({ where: { id: product.id }, data: { stockQty: stockBefore } });
  }
  console.log('cleanup ok');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
