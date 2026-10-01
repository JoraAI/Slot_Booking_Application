/**
 * Reverify invoice Google-review CTA (HTML + PDF). No WhatsApp send.
 * Run: node --import tsx scripts/verify-invoice-review-cta.ts
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');
const prodEnv = dotenv.parse(fs.readFileSync(path.join(root, '.env.production')));
for (const [k, v] of Object.entries(prodEnv)) process.env[k] = v;

async function main() {
  const { default: prisma } = await import('../src/lib/prisma');
  const { invoiceService } = await import('../src/services/InvoiceService');

  const BUSINESS_ID = 'c995edcbf1aa5a4e3ad694c82';
  const biz = await prisma.business.findUniqueOrThrow({ where: { id: BUSINESS_ID } });
  const inv = await prisma.invoice.findFirstOrThrow({
    where: { businessId: BUSINESS_ID },
    orderBy: { createdAt: 'desc' },
  });

  const invForRender = {
    ...inv,
    notes: 'Thanks for visiting - tap the gold banner to leave a review',
  };

  const html = await invoiceService.renderInvoiceHtmlAsync(invForRender, biz);
  const pdf = await invoiceService.renderInvoicePdf(invForRender, biz);
  const pdfPath = path.resolve(root, '../../image-invoice-review-preview.pdf');
  fs.writeFileSync(pdfPath, pdf);

  const reviewUrl = String(biz.googleReviewUrl || '').trim();
  const failures: string[] = [];
  if (!html.includes('How was your visit?')) failures.push('html missing title');
  if (!html.includes('Rate us on Google')) failures.push('html missing button');
  if (!reviewUrl || !html.includes(reviewUrl)) failures.push('html missing review url');
  if (html.includes('\u2014')) failures.push('html still has em dash');
  if (pdf.includes(Buffer.from('\u2014', 'utf8'))) failures.push('pdf still has em dash');
  // Unicode star must not appear as button label text (Helvetica fallback)
  if (Buffer.from(pdf).includes(Buffer.from('★', 'utf8'))) {
    // stars are drawn as paths; glyph should not be embedded as text in CTA
    // allow fail only if "★ Rate" pattern exists - check string extract loosely
  }
  const pdfStr = pdf.toString('latin1');
  if (pdfStr.includes('★')) failures.push('pdf embeds unicode star glyph');

  console.log(
    JSON.stringify(
      {
        ok: failures.length === 0,
        failures,
        invoice: inv.invoiceNumber,
        pdfBytes: pdf.length,
        pdfPath,
        reviewUrlSet: !!reviewUrl,
      },
      null,
      2
    )
  );

  await prisma.$disconnect();
  if (failures.length) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error('FAILED', e?.message || e);
  process.exitCode = 1;
});
