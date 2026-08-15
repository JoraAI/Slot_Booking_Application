-- Batch 2A: stable idempotency key for Razorpay X-Refund-Idempotency
-- (P0: refund creation must be safe under concurrency and network-timeout retries).

-- Add the column nullable first, backfill every existing row with a unique
-- value derived from the already-unique row id, then contract to NOT NULL and
-- add the unique index.
ALTER TABLE "PaymentRefund" ADD COLUMN "idempotencyKey" TEXT;

UPDATE "PaymentRefund" SET "idempotencyKey" = 'rfnd_idem_' || "id" WHERE "idempotencyKey" IS NULL;

ALTER TABLE "PaymentRefund" ALTER COLUMN "idempotencyKey" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRefund_idempotencyKey_key" ON "PaymentRefund"("idempotencyKey");
