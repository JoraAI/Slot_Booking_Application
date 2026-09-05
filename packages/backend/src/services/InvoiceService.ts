import PDFDocument from 'pdfkit';
import prisma from '../lib/prisma';

export type InvoiceLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

type InvoiceSource = 'booking_paid' | 'booking_completed' | 'walk_in' | 'manual';

class InvoiceService {
  private esc(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private formatMoney(amount: number, currency = 'INR'): string {
    if (currency === 'INR') return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    return `${currency} ${amount.toFixed(2)}`;
  }

  /** ASCII-safe money for PDFKit Helvetica (no ₹ glyph in WinAnsi). */
  private formatMoneyPdf(amount: number, currency = 'INR'): string {
    if (currency === 'INR') {
      return `Rs. ${amount.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    }
    return `${currency} ${Number(amount).toFixed(2)}`;
  }

  private formatDate(d: Date | string, tz = 'Asia/Kolkata'): string {
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: tz,
    }).format(new Date(d));
  }

  async nextInvoiceNumber(businessId: string): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `INV-${year}-`;
    const last = await prisma.invoice.findFirst({
      where: { businessId, invoiceNumber: { startsWith: prefix } },
      orderBy: { invoiceNumber: 'desc' },
      select: { invoiceNumber: true },
    });
    let seq = 1;
    if (last) {
      const n = parseInt(last.invoiceNumber.slice(prefix.length), 10);
      if (Number.isFinite(n)) seq = n + 1;
    }
    return `${prefix}${String(seq).padStart(4, '0')}`;
  }

  bookingLineItems(booking: any): InvoiceLineItem[] {
    const service = booking.serviceNameSnapshot || 'Service';
    const duration = booking.durationMinutesSnapshot ? ` (${booking.durationMinutesSnapshot} min)` : '';
    const staff = booking.staff?.name ? ` with ${booking.staff.name}` : '';
    const unitPrice = booking.paymentAmount ?? booking.finalPrice ?? booking.originalPrice ?? 0;
    return [{
      description: `${service}${duration}${staff}`,
      quantity: 1,
      unitPrice,
      amount: unitPrice,
    }];
  }

  private sumLineItems(items: InvoiceLineItem[]): number {
    return items.reduce((s, row) => s + row.amount, 0);
  }

  toListItem(invoice: any) {
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerName: invoice.customerName,
      customerPhone: invoice.customerPhone,
      customerEmail: invoice.customerEmail,
      total: invoice.total,
      currency: invoice.currency,
      source: invoice.source,
      paymentMethod: invoice.paymentMethod,
      issuedAt: invoice.issuedAt,
      bookingId: invoice.bookingId,
      booking: invoice.booking ? {
        id: invoice.booking.id,
        date: invoice.booking.date,
        startTime: invoice.booking.startTime,
        status: invoice.booking.status,
        serviceName: invoice.booking.serviceNameSnapshot,
      } : null,
    };
  }

  async createInvoiceRecord(
    businessId: string,
    data: {
      bookingId?: string | null;
      customerName: string;
      customerPhone?: string | null;
      customerEmail?: string | null;
      lineItems: InvoiceLineItem[];
      taxAmount?: number;
      currency?: string;
      notes?: string | null;
      paymentMethod?: string | null;
      paymentRef?: string | null;
      source: InvoiceSource;
      issuedAt?: Date;
    }
  ) {
    const subtotal = this.sumLineItems(data.lineItems);
    const taxAmount = data.taxAmount ?? 0;
    const total = subtotal + taxAmount;
    if (total <= 0) {
      const err: any = new Error('Invoice total must be greater than zero');
      err.status = 400;
      throw err;
    }
    const invoiceNumber = await this.nextInvoiceNumber(businessId);
    return prisma.invoice.create({
      data: {
        businessId,
        bookingId: data.bookingId ?? null,
        invoiceNumber,
        customerName: data.customerName,
        customerPhone: data.customerPhone ?? null,
        customerEmail: data.customerEmail ?? null,
        lineItems: data.lineItems as any,
        subtotal,
        taxAmount,
        total,
        currency: data.currency || 'INR',
        notes: data.notes ?? null,
        paymentMethod: data.paymentMethod ?? null,
        paymentRef: data.paymentRef ?? null,
        source: data.source,
        issuedAt: data.issuedAt ?? new Date(),
      },
      include: {
        booking: {
          select: {
            id: true, date: true, startTime: true, endTime: true, status: true,
            serviceNameSnapshot: true, paymentStatus: true,
          },
        },
      },
    });
  }

  async getOrCreatePaidBookingInvoice(businessId: string, bookingId: string) {
    const existing = await prisma.invoice.findUnique({
      where: { bookingId },
      include: {
        booking: {
          select: {
            id: true, date: true, startTime: true, endTime: true, status: true,
            serviceNameSnapshot: true, paymentStatus: true,
          },
        },
      },
    });
    if (existing) return existing;

    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, businessId },
      include: { staff: true, business: true },
    });
    if (!booking) {
      const err: any = new Error('Booking not found');
      err.status = 404;
      throw err;
    }
    const paid = (booking.paymentStatus === 'paid' || booking.paymentStatus === 'partial')
      && (booking.paymentAmount ?? 0) > 0;
    if (!paid || booking.paymentStatus === 'refunded') {
      const err: any = new Error('Invoice is only available for paid bookings');
      err.status = 403;
      throw err;
    }

    return this.createInvoiceRecord(businessId, {
      bookingId: booking.id,
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
      customerEmail: booking.customerEmail,
      lineItems: this.bookingLineItems(booking),
      paymentMethod: 'razorpay',
      paymentRef: booking.razorpayPaymentId,
      source: 'booking_paid',
      notes: booking.id ? `Booking reference: ${booking.id}` : null,
    });
  }

  async createFromCompletedBooking(
    businessId: string,
    bookingId: string,
    opts: { amount?: number; paymentMethod?: string; notes?: string } = {}
  ) {
    const existing = await prisma.invoice.findUnique({ where: { bookingId } });
    if (existing) return existing;

    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, businessId },
      include: { staff: true },
    });
    if (!booking) {
      const err: any = new Error('Booking not found');
      err.status = 404;
      throw err;
    }
    if (booking.status !== 'COMPLETED') {
      const err: any = new Error('Invoice can only be issued for completed bookings');
      err.status = 400;
      throw err;
    }
    if (booking.paymentStatus === 'paid' || booking.paymentStatus === 'partial') {
      return this.getOrCreatePaidBookingInvoice(businessId, bookingId);
    }

    const amount = opts.amount ?? booking.finalPrice ?? booking.originalPrice ?? 0;
    const lineItems: InvoiceLineItem[] = [{
      description: `${booking.serviceNameSnapshot || 'Service'}${booking.durationMinutesSnapshot ? ` (${booking.durationMinutesSnapshot} min)` : ''}`,
      quantity: 1,
      unitPrice: amount,
      amount,
    }];

    return this.createInvoiceRecord(businessId, {
      bookingId: booking.id,
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
      customerEmail: booking.customerEmail,
      lineItems,
      paymentMethod: opts.paymentMethod || 'cash',
      source: 'booking_completed',
      notes: opts.notes || `Completed booking on ${this.formatDate(booking.date)}`,
    });
  }

  async createWalkInInvoice(
    businessId: string,
    payload: {
      customerName: string;
      customerPhone?: string | null;
      customerEmail?: string | null;
      lineItems: InvoiceLineItem[];
      taxAmount?: number;
      notes?: string | null;
      paymentMethod?: string | null;
      paymentRef?: string | null;
    }
  ) {
    if (!payload.customerName?.trim()) {
      const err: any = new Error('Customer name is required');
      err.status = 400;
      throw err;
    }
    if (!payload.lineItems?.length) {
      const err: any = new Error('At least one line item is required');
      err.status = 400;
      throw err;
    }
    return this.createInvoiceRecord(businessId, {
      bookingId: null,
      customerName: payload.customerName.trim(),
      customerPhone: payload.customerPhone ?? null,
      customerEmail: payload.customerEmail ?? null,
      lineItems: payload.lineItems,
      taxAmount: payload.taxAmount ?? 0,
      notes: payload.notes ?? null,
      paymentMethod: payload.paymentMethod ?? 'cash',
      paymentRef: payload.paymentRef ?? null,
      source: 'walk_in',
    });
  }

  /** Generate a compact invoice PDF for email attachment + WhatsApp document header. */
  async renderInvoicePdf(invoice: any, business: any): Promise<Buffer> {
    const tz = business.timezone || 'Asia/Kolkata';
    const items = (invoice.lineItems as InvoiceLineItem[]) || [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    doc.fontSize(18).fillColor('#111827').text('Tax Invoice', { continued: false });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#6b7280')
      .text(`${invoice.invoiceNumber} · Issued ${this.formatDate(invoice.issuedAt, tz)}`);
    doc.moveDown(1);

    const leftX = doc.x;
    const midY = doc.y;
    doc.fontSize(9).fillColor('#6b7280').text('FROM', leftX, midY);
    doc.fontSize(11).fillColor('#111827').text(String(business.name || 'Salon'), leftX, midY + 14, { width: 220 });
    if (business.address) {
      doc.fontSize(9).fillColor('#6b7280').text(String(business.address), leftX, doc.y, { width: 220 });
    }
    if (business.ownerEmail) {
      doc.fontSize(9).fillColor('#6b7280').text(String(business.ownerEmail), leftX, doc.y, { width: 220 });
    }
    const leftBottom = doc.y;

    const rightX = 320;
    doc.fontSize(9).fillColor('#6b7280').text('BILL TO', rightX, midY);
    doc.fontSize(11).fillColor('#111827').text(String(invoice.customerName || 'Customer'), rightX, midY + 14, { width: 220 });
    if (invoice.customerPhone) {
      doc.fontSize(9).fillColor('#6b7280').text(String(invoice.customerPhone), rightX, doc.y, { width: 220 });
    }
    if (invoice.customerEmail) {
      doc.fontSize(9).fillColor('#6b7280').text(String(invoice.customerEmail), rightX, doc.y, { width: 220 });
    }
    doc.y = Math.max(leftBottom, doc.y) + 16;

    if (invoice.booking) {
      doc.fontSize(9).fillColor('#6b7280').text(
        `Appointment: ${this.formatDate(invoice.booking.date, tz)} · ${invoice.booking.startTime || ''}` +
          (invoice.booking.endTime ? ` – ${invoice.booking.endTime}` : '')
      );
      doc.moveDown(0.8);
    }

    const colDesc = 50;
    const colQty = 320;
    const colRate = 380;
    const colAmt = 460;
    let y = doc.y;

    doc.fontSize(8).fillColor('#6b7280');
    doc.text('DESCRIPTION', colDesc, y, { width: 250 });
    doc.text('QTY', colQty, y, { width: 40, align: 'right' });
    doc.text('RATE', colRate, y, { width: 60, align: 'right' });
    doc.text('AMOUNT', colAmt, y, { width: 80, align: 'right' });
    y += 14;
    doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e7eb').stroke();
    y += 8;

    for (const row of items) {
      if (y > 720) {
        doc.addPage();
        y = 50;
      }
      doc.fontSize(9).fillColor('#111827');
      const descHeight = doc.heightOfString(String(row.description || 'Item'), { width: 250 });
      doc.text(String(row.description || 'Item'), colDesc, y, { width: 250 });
      doc.text(String(row.quantity), colQty, y, { width: 40, align: 'right' });
      doc.text(this.formatMoneyPdf(row.unitPrice, invoice.currency), colRate, y, { width: 60, align: 'right' });
      doc.text(this.formatMoneyPdf(row.amount, invoice.currency), colAmt, y, { width: 80, align: 'right' });
      y += Math.max(descHeight, 12) + 6;
    }

    doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e7eb').stroke();
    y += 12;
    const totalsX = 360;
    doc.fontSize(10).fillColor('#111827');
    doc.text('Subtotal', totalsX, y, { width: 80 });
    doc.text(this.formatMoneyPdf(invoice.subtotal, invoice.currency), colAmt, y, { width: 80, align: 'right' });
    y += 16;
    if (invoice.taxAmount > 0) {
      doc.text('Tax', totalsX, y, { width: 80 });
      doc.text(this.formatMoneyPdf(invoice.taxAmount, invoice.currency), colAmt, y, { width: 80, align: 'right' });
      y += 16;
    }
    doc.fontSize(12).text('Total', totalsX, y, { width: 80 });
    doc.fontSize(12).text(this.formatMoneyPdf(invoice.total, invoice.currency), colAmt, y, {
      width: 80,
      align: 'right',
    });
    y += 24;
    doc.y = y;

    if (invoice.paymentMethod) {
      doc.fontSize(9).fillColor('#6b7280').text(
        `Payment: ${invoice.paymentMethod}${invoice.paymentRef ? ` · Ref ${invoice.paymentRef}` : ''}`
      );
    }
    if (invoice.notes) {
      doc.moveDown(0.4);
      doc.fontSize(9).fillColor('#6b7280').text(String(invoice.notes), { width: 480 });
    }

    doc.end();
    return done;
  }

  renderInvoiceHtml(invoice: any, business: any): string {
    const tz = business.timezone || 'Asia/Kolkata';
    const items = (invoice.lineItems as InvoiceLineItem[]) || [];
    const rows = items.map((row) => `
      <tr>
        <td>${this.esc(row.description)}</td>
        <td class="num">${row.quantity}</td>
        <td class="num">${this.esc(this.formatMoney(row.unitPrice, invoice.currency))}</td>
        <td class="num">${this.esc(this.formatMoney(row.amount, invoice.currency))}</td>
      </tr>
    `).join('');

    const bookingMeta = invoice.booking ? `
      <p class="meta">Appointment: ${this.esc(this.formatDate(invoice.booking.date, tz))} · ${this.esc(invoice.booking.startTime)}${invoice.booking.endTime ? ` – ${this.esc(invoice.booking.endTime)}` : ''}</p>
    ` : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Invoice ${this.esc(invoice.invoiceNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 24px; color: #111827; background: #f9fafb; }
    .sheet { max-width: 720px; margin: 0 auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 24px; }
    h1 { margin: 0 0 4px; font-size: 1.5rem; }
    .muted { color: #6b7280; font-size: 0.875rem; }
    .grid { display: grid; gap: 16px; margin: 20px 0; }
    @media (min-width: 640px) { .grid { grid-template-columns: 1fr 1fr; } }
    .card { background: #f9fafb; border-radius: 12px; padding: 14px; }
    .card h2 { margin: 0 0 8px; font-size: 0.75rem; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 0.9rem; }
    th, td { padding: 10px 8px; border-bottom: 1px solid #e5e7eb; text-align: left; vertical-align: top; }
    th { font-size: 0.75rem; text-transform: uppercase; color: #6b7280; }
    .num { text-align: right; white-space: nowrap; }
    .totals { margin-top: 12px; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
    .totals div { display: flex; justify-content: space-between; width: min(280px, 100%); gap: 12px; }
    .grand { font-weight: 700; font-size: 1.1rem; }
    .meta { margin: 4px 0 0; }
    .actions { margin-top: 20px; display: flex; gap: 8px; flex-wrap: wrap; }
    button { background: #7c3aed; color: #fff; border: 0; border-radius: 10px; padding: 10px 16px; font-size: 0.9rem; cursor: pointer; }
    @media print { body { background: #fff; padding: 0; } .sheet { border: 0; border-radius: 0; } .actions { display: none; } }
  </style>
</head>
<body>
  <div class="sheet">
    <h1>Tax Invoice</h1>
    <p class="muted">${this.esc(invoice.invoiceNumber)} · Issued ${this.esc(this.formatDate(invoice.issuedAt, tz))}</p>
    <div class="grid">
      <div class="card">
        <h2>From</h2>
        <p><strong>${this.esc(business.name)}</strong></p>
        ${business.address ? `<p class="muted">${this.esc(business.address)}</p>` : ''}
        ${business.ownerEmail ? `<p class="muted">${this.esc(business.ownerEmail)}</p>` : ''}
      </div>
      <div class="card">
        <h2>Bill to</h2>
        <p><strong>${this.esc(invoice.customerName)}</strong></p>
        ${invoice.customerPhone ? `<p class="muted">${this.esc(invoice.customerPhone)}</p>` : ''}
        ${invoice.customerEmail ? `<p class="muted">${this.esc(invoice.customerEmail)}</p>` : ''}
      </div>
    </div>
    ${bookingMeta}
    <table>
      <thead>
        <tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div><span>Subtotal</span><span>${this.esc(this.formatMoney(invoice.subtotal, invoice.currency))}</span></div>
      ${invoice.taxAmount > 0 ? `<div><span>Tax</span><span>${this.esc(this.formatMoney(invoice.taxAmount, invoice.currency))}</span></div>` : ''}
      <div class="grand"><span>Total</span><span>${this.esc(this.formatMoney(invoice.total, invoice.currency))}</span></div>
    </div>
    ${invoice.paymentMethod ? `<p class="muted" style="margin-top:16px">Payment: ${this.esc(invoice.paymentMethod)}${invoice.paymentRef ? ` · Ref ${this.esc(invoice.paymentRef)}` : ''}</p>` : ''}
    ${invoice.notes ? `<p class="muted">${this.esc(invoice.notes)}</p>` : ''}
    <div class="actions"><button type="button" onclick="window.print()">Print / Save as PDF</button></div>
  </div>
</body>
</html>`;
  }

  bookingHasInvoiceAccess(booking: any): boolean {
    if (!booking) return false;
    if (booking.paymentStatus === 'refunded') return false;
    return (booking.paymentStatus === 'paid' || booking.paymentStatus === 'partial')
      && (booking.paymentAmount ?? 0) > 0;
  }

  async sendInvoice(
    businessId: string,
    invoiceId: string,
    channels: Array<'email' | 'whatsapp'>
  ) {
    const unique = Array.from(new Set(channels));
    if (!unique.length) {
      const err: any = new Error('Select email and/or WhatsApp');
      err.status = 400;
      throw err;
    }

    const [business, invoice] = await Promise.all([
      prisma.business.findUnique({ where: { id: businessId } }),
      prisma.invoice.findFirst({
        where: { id: invoiceId, businessId },
        include: {
          booking: {
            select: {
              id: true, date: true, startTime: true, endTime: true, status: true,
              serviceNameSnapshot: true, paymentStatus: true,
            },
          },
        },
      }),
    ]);
    if (!business) {
      const err: any = new Error('Business not found');
      err.status = 404;
      throw err;
    }
    if (!invoice) {
      const err: any = new Error('Invoice not found');
      err.status = 404;
      throw err;
    }

    const phone = String(invoice.customerPhone || '').trim();
    const email = String(invoice.customerEmail || '').trim();
    for (const ch of unique) {
      if (ch === 'email' && !email) {
        const err: any = new Error('Invoice has no customer email');
        err.status = 400;
        throw err;
      }
      if (ch === 'whatsapp' && !phone) {
        const err: any = new Error('Invoice has no customer phone');
        err.status = 400;
        throw err;
      }
    }

    const { notificationService } = await import('./NotificationService');
    const { createDocumentMediaAsset, publicMediaUrl } = await import('./MediaService');

    const html = this.renderInvoiceHtml(invoice, business);
    const pdfBytes = await this.renderInvoicePdf(invoice, business);
    const filename = `${String(invoice.invoiceNumber || 'invoice').replace(/[^\w.-]+/g, '_')}.pdf`;

    // Persist PDF only when WhatsApp needs a public HTTPS URL for Gupshup to fetch.
    let documentUrl = '';
    if (unique.includes('whatsapp')) {
      const asset = await createDocumentMediaAsset(businessId, pdfBytes, 'application/pdf');
      documentUrl = publicMediaUrl(asset.id);
    }

    const results = await notificationService.sendInvoiceToCustomer(
      businessId,
      invoice,
      html,
      unique,
      {
        pdf: { filename, content: pdfBytes, contentType: 'application/pdf' },
        documentUrl,
        documentFilename: filename,
      }
    );
    return { results };
  }
}

export const invoiceService = new InvoiceService();
