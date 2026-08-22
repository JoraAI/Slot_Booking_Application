-- Batch 5: WhatsApp multi-tenant prepaid wallet.
-- Models: WhatsAppConfig, Wallet, WalletTransaction, WhatsAppPricing, WhatsAppMessageLog.
-- Backfills Wallet (balance 0) for every business and a LEGACY WhatsAppConfig for
-- existing DIY-Meta salons. Seeds DB-configurable per-message prices (integer paise).

-- CreateTable
CREATE TABLE "WhatsAppConfig" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "phoneNumberId" TEXT,
    "wabaId" TEXT,
    "displayPhone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "connectionMode" TEXT NOT NULL DEFAULT 'LEGACY',
    "accessTokenEnc" TEXT,
    "templateUtility" TEXT,
    "templateMarketing" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "balancePaise" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 0,
    "lowBalanceThresholdPaise" INTEGER NOT NULL DEFAULT 50000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "balanceBeforePaise" INTEGER NOT NULL,
    "balanceAfterPaise" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "referenceType" TEXT,
    "referenceId" TEXT,
    "providerPaymentId" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "WhatsAppPricing" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "category" TEXT NOT NULL,
    "pricePaise" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppPricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessageLog" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "bookingId" TEXT,
    "customerId" TEXT,
    "toPhone" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'UTILITY',
    "template" TEXT,
    "costPaise" INTEGER NOT NULL DEFAULT 0,
    "reservationTxId" TEXT,
    "providerMessageId" TEXT,
    "status" TEXT NOT NULL,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConfig_businessId_key" ON "WhatsAppConfig"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_businessId_key" ON "Wallet"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_providerPaymentId_key" ON "WalletTransaction"("providerPaymentId");

-- CreateIndex
CREATE INDEX "WalletTransaction_businessId_createdAt_idx" ON "WalletTransaction"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletTransaction_businessId_type_idx" ON "WalletTransaction"("businessId", "type");

-- CreateIndex
CREATE INDEX "WalletTransaction_referenceType_referenceId_idx" ON "WalletTransaction"("referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppPricing_country_currency_category_key" ON "WhatsAppPricing"("country", "currency", "category");

-- CreateIndex
CREATE INDEX "WhatsAppMessageLog_businessId_createdAt_idx" ON "WhatsAppMessageLog"("businessId", "createdAt");

-- AddForeignKey
ALTER TABLE "WhatsAppConfig" ADD CONSTRAINT "WhatsAppConfig_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessageLog" ADD CONSTRAINT "WhatsAppMessageLog_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every existing business gets a Wallet with balance 0 (no credits gifted).
INSERT INTO "Wallet" ("id", "businessId", "balancePaise", "currency", "status", "version", "lowBalanceThresholdPaise", "createdAt", "updatedAt")
SELECT 'wal_' || "Business"."id", "Business"."id", 0, 'INR', 'ACTIVE', 0, 50000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Business"
ON CONFLICT ("businessId") DO NOTHING;

-- Backfill: salons that already store DIY Meta credentials become LEGACY WhatsAppConfig.
INSERT INTO "WhatsAppConfig" ("id", "businessId", "phoneNumberId", "wabaId", "displayPhone", "status", "connectionMode", "accessTokenEnc", "templateUtility", "templateMarketing", "enabled", "createdAt", "updatedAt")
SELECT 'wac_' || "Business"."id",
       "Business"."id",
       "metaWhatsappPhoneNumberId",
       "metaWhatsappBusinessAccountId",
       NULL,
       CASE WHEN "metaWhatsappPhoneNumberId" IS NOT NULL AND "metaWhatsappAccessTokenEnc" IS NOT NULL THEN 'CONNECTED' ELSE 'DISCONNECTED' END,
       'LEGACY',
       "metaWhatsappAccessTokenEnc",
       "metaWhatsappTemplateUtility",
       "metaWhatsappTemplateMarketing",
       "metaWhatsappPhoneNumberId" IS NOT NULL AND "metaWhatsappAccessTokenEnc" IS NOT NULL,
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
FROM "Business"
WHERE "metaWhatsappPhoneNumberId" IS NOT NULL
   OR "metaWhatsappBusinessAccountId" IS NOT NULL
   OR "metaWhatsappAccessTokenEnc" IS NOT NULL
   OR "metaWhatsappTemplateUtility" IS NOT NULL
   OR "metaWhatsappTemplateMarketing" IS NOT NULL
ON CONFLICT ("businessId") DO NOTHING;

-- Seed DB-configurable per-message prices (integer paise, INR/India).
-- Tenant charge ≈ 2× modeled Meta cost (x → 2x for the same message volume).
-- Editable via admin route; not hard-coded in send logic.
INSERT INTO "WhatsAppPricing" ("id", "country", "currency", "category", "pricePaise", "active", "createdAt") VALUES
('price_in_utility', 'IN', 'INR', 'UTILITY', 100, true, CURRENT_TIMESTAMP),
('price_in_marketing', 'IN', 'INR', 'MARKETING', 170, true, CURRENT_TIMESTAMP),
('price_in_service', 'IN', 'INR', 'SERVICE', 80, true, CURRENT_TIMESTAMP),
('price_in_authentication', 'IN', 'INR', 'AUTHENTICATION', 60, true, CURRENT_TIMESTAMP)
ON CONFLICT ("country", "currency", "category") DO NOTHING;

