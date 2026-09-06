import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import prisma from '../lib/prisma';

export type InvoiceLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

export type InvoiceDiscountInput = {
  discountType?: 'PERCENTAGE' | 'FLAT' | null;
  discountValue?: number | null;
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

  private round2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  /** Compute discount amount from subtotal + type/value. Clamped to [0, subtotal]. */
  computeDiscount(
    subtotal: number,
    input?: InvoiceDiscountInput | null
  ): { discountType: 'PERCENTAGE' | 'FLAT' | null; discountValue: number | null; discountAmount: number } {
    const type = input?.discountType === 'PERCENTAGE' || input?.discountType === 'FLAT'
      ? input.discountType
      : null;
    const rawValue = Number(input?.discountValue);
    if (!type || !Number.isFinite(rawValue) || rawValue <= 0 || subtotal <= 0) {
      return { discountType: null, discountValue: null, discountAmount: 0 };
    }
    let amount = 0;
    if (type === 'PERCENTAGE') {
      const pct = Math.min(100, Math.max(0, rawValue));
      amount = (subtotal * pct) / 100;
    } else {
      amount = Math.max(0, rawValue);
    }
    amount = Math.min(this.round2(amount), this.round2(subtotal));
    return {
      discountType: type,
      discountValue: this.round2(rawValue),
      discountAmount: amount,
    };
  }

  private absolutePublicUrl(pathOrUrl: string): string | null {
    const raw = String(pathOrUrl || '').trim();
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) return raw;
    const base = (process.env.FRONTEND_PUBLIC_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
    if (!base) return raw.startsWith('/') ? null : null;
    if (raw.startsWith('/')) return `${base}${raw}`;
    return `${base}/${raw}`;
  }

  /** Public HTTPS URL for logo in HTML invoices / email clients. */
  logoPublicUrl(business: { logoUrl?: string | null }): string | null {
    return this.absolutePublicUrl(String(business?.logoUrl || ''));
  }

  /** Load salon logo as PNG/JPEG buffer for PDF (converts WebP via sharp). */
  private async loadLogoPng(business: { logoUrl?: string | null }): Promise<Buffer | null> {
    const raw = String(business?.logoUrl || '').trim();
    if (!raw) return null;

    let bytes: Buffer | null = null;
    const mediaMatch = raw.match(/\/api\/media\/([^/?#]+)/);
    if (mediaMatch?.[1]) {
      const asset = await prisma.mediaAsset.findUnique({
        where: { id: mediaMatch[1] },
        select: { data: true, mimeType: true },
      });
      if (asset) bytes = Buffer.from(asset.data);
    } else {
      const url = this.absolutePublicUrl(raw);
      if (url && /^https?:\/\//i.test(url)) {
        try {
          const res = await fetch(url);
          if (res.ok) bytes = Buffer.from(await res.arrayBuffer());
        } catch {
          /* logo optional */
        }
      }
    }
    if (!bytes?.length) return null;

    try {
      return await sharp(bytes, { failOn: 'none' })
        .rotate()
        .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
    } catch {
      return null;
    }
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
      subtotal: invoice.subtotal,
      taxAmount: invoice.taxAmount,
      discountType: invoice.discountType ?? null,
      discountValue: invoice.discountValue ?? null,
      discountAmount: invoice.discountAmount ?? 0,
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
      discountType?: 'PERCENTAGE' | 'FLAT' | null;
      discountValue?: number | null;
    }
  ) {
    const subtotal = this.round2(this.sumLineItems(data.lineItems));
    const taxAmount = this.round2(data.taxAmount ?? 0);
    const discount = this.computeDiscount(subtotal, {
      discountType: data.discountType,
      discountValue: data.discountValue,
    });
    const total = this.round2(subtotal - discount.discountAmount + taxAmount);
    if (total <= 0) {
      const err: any = new Error(
        discount.discountAmount > 0
          ? 'Invoice total must be greater than zero after discount'
          : 'Invoice total must be greater than zero'
      );
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
        discountType: discount.discountType,
        discountValue: discount.discountValue,
        discountAmount: discount.discountAmount,
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
      discountType?: 'PERCENTAGE' | 'FLAT' | null;
      discountValue?: number | null;
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
      discountType: payload.discountType ?? null,
      discountValue: payload.discountValue ?? null,
    });
  }

  /** Generate a compact invoice PDF for email attachment + WhatsApp document header. */
  async renderInvoicePdf(invoice: any, business: any): Promise<Buffer> {
    const tz = business.timezone || 'Asia/Kolkata';
    const items = (invoice.lineItems as InvoiceLineItem[]) || [];
    const logoPng = await this.loadLogoPng(business);
    const discountAmount = Number(invoice.discountAmount) || 0;
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    if (logoPng) {
      try {
        // Soft centered watermark (large, low opacity).
        const wmSize = 320;
        const wmX = (doc.page.width - wmSize) / 2;
        const wmY = (doc.page.height - wmSize) / 2 - 20;
        doc.save();
        doc.opacity(0.05);
        doc.image(logoPng, wmX, wmY, { fit: [wmSize, wmSize], align: 'center', valign: 'center' });
        doc.restore();
      } catch {
        /* watermark optional */
      }
    }

    // Masthead: logo + salon name left, invoice title right.
    const headerTop = 42;
    if (logoPng) {
      try {
        const logoBox = 56;
        // Soft plate behind logo
        doc.save();
        doc.roundedRect(50, headerTop, logoBox, logoBox, 12).fill('#F3F4F6');
        doc.restore();
        // Clip logo into the rounded plate
        doc.save();
        doc.roundedRect(50, headerTop, logoBox, logoBox, 12).clip();
        doc.image(logoPng, 56, headerTop + 6, { fit: [44, 44], align: 'center', valign: 'center' });
        doc.restore();

        // Keep salon name to one line so it never overlaps the label below.
        doc.fontSize(14).fillColor('#111827')
          .text(String(business.name || 'Salon'), 118, headerTop + 10, {
            width: 230,
            height: 18,
            ellipsis: true,
            lineBreak: false,
          });
        doc.fontSize(9).fillColor('#7C3AED')
          .text('TAX INVOICE', 118, headerTop + 34);

        doc.fontSize(11).fillColor('#111827')
          .text(String(invoice.invoiceNumber || ''), 360, headerTop + 10, { width: 185, align: 'right' });
        doc.fontSize(9).fillColor('#6B7280')
          .text(`Issued ${this.formatDate(invoice.issuedAt, tz)}`, 360, headerTop + 28, { width: 185, align: 'right' });

        doc.moveTo(50, headerTop + logoBox + 14).lineTo(545, headerTop + logoBox + 14)
          .strokeColor('#E5E7EB').lineWidth(1).stroke();
        doc.y = headerTop + logoBox + 28;
        doc.x = 50;
      } catch {
        doc.fontSize(18).fillColor('#111827').text('Tax Invoice', 50, headerTop);
        doc.fontSize(10).fillColor('#6b7280')
          .text(`${invoice.invoiceNumber} · Issued ${this.formatDate(invoice.issuedAt, tz)}`);
        doc.moveDown(1);
      }
    } else {
      doc.fontSize(18).fillColor('#111827').text('Tax Invoice', 50, headerTop);
      doc.fontSize(10).fillColor('#6b7280')
        .text(`${invoice.invoiceNumber} · Issued ${this.formatDate(invoice.issuedAt, tz)}`, 50, headerTop + 26);
      doc.y = headerTop + 52;
      doc.x = 50;
    }

    const leftX = 50;
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
    if (discountAmount > 0) {
      const discLabel =
        invoice.discountType === 'PERCENTAGE' && invoice.discountValue != null
          ? `Discount (${invoice.discountValue}%)`
          : 'Discount';
      doc.fillColor('#059669').text(discLabel, totalsX, y, { width: 80 });
      doc.text(`- ${this.formatMoneyPdf(discountAmount, invoice.currency)}`, colAmt, y, { width: 80, align: 'right' });
      y += 16;
      doc.fillColor('#111827');
    }
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
    return this.buildInvoiceHtml(invoice, business, this.logoPublicUrl(business));
  }

  /** Prefer embedded logo so View/Download and email work without a public CDN URL. */
  async renderInvoiceHtmlAsync(invoice: any, business: any): Promise<string> {
    const logoPng = await this.loadLogoPng(business);
    const logoSrc = logoPng
      ? `data:image/png;base64,${logoPng.toString('base64')}`
      : this.logoPublicUrl(business);
    return this.buildInvoiceHtml(invoice, business, logoSrc);
  }

  private buildInvoiceHtml(invoice: any, business: any, logoUrl: string | null): string {
    const tz = business.timezone || 'Asia/Kolkata';
    const items = (invoice.lineItems as InvoiceLineItem[]) || [];
    const discountAmount = Number(invoice.discountAmount) || 0;
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

    const discountRow = discountAmount > 0
      ? `<div class="disc"><span>${
          invoice.discountType === 'PERCENTAGE' && invoice.discountValue != null
            ? `Discount (${this.esc(invoice.discountValue)}%)`
            : 'Discount'
        }</span><span>- ${this.esc(this.formatMoney(discountAmount, invoice.currency))}</span></div>`
      : '';

    const brandHeader = logoUrl
      ? `<div class="masthead">
          <div class="masthead-left">
            <div class="logo-frame"><img src="${this.esc(logoUrl)}" alt="${this.esc(business.name || 'Logo')}" /></div>
            <div class="masthead-meta">
              <p class="salon-name">${this.esc(business.name || 'Salon')}</p>
              <p class="doc-label">Tax Invoice</p>
            </div>
          </div>
          <div class="masthead-right">
            <p class="inv-no">${this.esc(invoice.invoiceNumber)}</p>
            <p class="inv-date">Issued ${this.esc(this.formatDate(invoice.issuedAt, tz))}</p>
          </div>
        </div>`
      : `<div class="masthead masthead-plain">
          <div>
            <h1>Tax Invoice</h1>
            <p class="muted">${this.esc(invoice.invoiceNumber)} · Issued ${this.esc(this.formatDate(invoice.issuedAt, tz))}</p>
          </div>
        </div>`;

    const watermark = logoUrl
      ? `<div class="watermark" aria-hidden="true"><div class="watermark-inner"><img src="${this.esc(logoUrl)}" alt="" /></div></div>`
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Invoice ${this.esc(invoice.invoiceNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 24px; color: #111827; background: #f3f4f6; }
    .sheet { position: relative; max-width: 720px; margin: 0 auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 18px; padding: 28px 28px 32px; overflow: hidden; box-shadow: 0 10px 30px rgba(17,24,39,.04); }
    .watermark { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 0; }
    .watermark-inner {
      width: min(62%, 340px); aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
      transform: rotate(-18deg); opacity: 0.055; filter: grayscale(1);
    }
    .watermark-inner img { width: 100%; height: 100%; object-fit: contain; }
    .content { position: relative; z-index: 1; }
    .masthead {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px;
      padding-bottom: 18px; margin-bottom: 20px; border-bottom: 1px solid #e5e7eb;
    }
    .masthead-left { display: flex; align-items: center; gap: 14px; min-width: 0; flex: 1; }
    .logo-frame {
      width: 64px; height: 64px; border-radius: 16px; background: linear-gradient(145deg, #f9fafb, #eef2ff);
      border: 1px solid #e5e7eb; display: flex; align-items: center; justify-content: center;
      overflow: hidden; flex-shrink: 0; box-shadow: 0 1px 2px rgba(0,0,0,.04);
    }
    .logo-frame img { width: 78%; height: 78%; object-fit: contain; }
    .masthead-meta { min-width: 0; }
    .salon-name { margin: 0; font-size: 1.125rem; font-weight: 700; letter-spacing: -0.01em; line-height: 1.25; overflow-wrap: anywhere; word-break: break-word; }
    .doc-label { margin: 4px 0 0; font-size: 0.75rem; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: #7c3aed; }
    .masthead-right { text-align: right; flex-shrink: 0; }
    .inv-no { margin: 0; font-size: 0.95rem; font-weight: 600; color: #111827; }
    .inv-date { margin: 4px 0 0; font-size: 0.8125rem; color: #6b7280; }
    .masthead-plain h1 { margin: 0 0 4px; font-size: 1.5rem; }
    h1 { margin: 0 0 4px; font-size: 1.5rem; }
    .muted { color: #6b7280; font-size: 0.875rem; }
    .grid { display: grid; gap: 16px; margin: 8px 0 20px; }
    @media (min-width: 640px) { .grid { grid-template-columns: 1fr 1fr; } }
    .card { background: #f9fafb; border-radius: 12px; padding: 14px; border: 1px solid #f3f4f6; }
    .card h2 { margin: 0 0 8px; font-size: 0.7rem; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 0.9rem; }
    th, td { padding: 10px 8px; border-bottom: 1px solid #e5e7eb; text-align: left; vertical-align: top; }
    th { font-size: 0.7rem; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
    .num { text-align: right; white-space: nowrap; }
    .totals { margin-top: 12px; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
    .totals div { display: flex; justify-content: space-between; width: min(280px, 100%); gap: 12px; }
    .totals .disc { color: #059669; }
    .grand { font-weight: 700; font-size: 1.1rem; }
    .meta { margin: 4px 0 0; }
    .actions { margin-top: 20px; display: flex; gap: 8px; flex-wrap: wrap; }
    button { background: #7c3aed; color: #fff; border: 0; border-radius: 10px; padding: 10px 16px; font-size: 0.9rem; cursor: pointer; }
    @media print {
      body { background: #fff; padding: 0; }
      .sheet { border: 0; border-radius: 0; box-shadow: none; }
      .actions { display: none; }
      .watermark-inner { opacity: 0.04; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    ${watermark}
    <div class="content">
      ${brandHeader}
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
        ${discountRow}
        ${invoice.taxAmount > 0 ? `<div><span>Tax</span><span>${this.esc(this.formatMoney(invoice.taxAmount, invoice.currency))}</span></div>` : ''}
        <div class="grand"><span>Total</span><span>${this.esc(this.formatMoney(invoice.total, invoice.currency))}</span></div>
      </div>
      ${invoice.paymentMethod ? `<p class="muted" style="margin-top:16px">Payment: ${this.esc(invoice.paymentMethod)}${invoice.paymentRef ? ` · Ref ${this.esc(invoice.paymentRef)}` : ''}</p>` : ''}
      ${invoice.notes ? `<p class="muted">${this.esc(invoice.notes)}</p>` : ''}
      <div class="actions"><button type="button" onclick="window.print()">Print / Save as PDF</button></div>
    </div>
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

    const html = await this.renderInvoiceHtmlAsync(invoice, business);
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
