ALTER TABLE "Business"
  ADD COLUMN "subscriptionStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "subscriptionPaidUntil" TIMESTAMP(3),
  ADD COLUMN "subscriptionCommissionPaidForMonth" TEXT,
  ADD COLUMN "subscriptionCommissionPaidInr" INTEGER DEFAULT 0,
  ADD COLUMN "subscriptionLastPaidAt" TIMESTAMP(3);
