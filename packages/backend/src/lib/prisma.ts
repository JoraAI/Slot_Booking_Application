import { PrismaClient } from '@prisma/client';

// Interactive $transaction default budget is 5s, which flakes on slow/remote
// Postgres (e.g. Neon free tier) under parallel load. Raise the default so
// advisory-lock refund flows and wallet recharges have headroom.
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  transactionOptions: { maxWait: 10_000, timeout: 15_000 },
});

export default prisma;