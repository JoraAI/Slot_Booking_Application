ALTER TABLE "Business"
  ADD COLUMN "subscriptionPlan" TEXT NOT NULL DEFAULT 'COMMISSION',
  ADD COLUMN "subscriptionCommissionPercent" DOUBLE PRECISION,
  ADD COLUMN "subscriptionMonthlyInr" INTEGER NOT NULL DEFAULT 799;
