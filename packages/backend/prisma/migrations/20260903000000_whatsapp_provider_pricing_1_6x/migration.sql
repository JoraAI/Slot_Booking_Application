-- Provider-aware WhatsApp wallet pricing (1.6× wholesale).
-- Meta wholesale (modeled IN paise): UTILITY 50, MARKETING 85, SERVICE 40, AUTH 30
-- Twilio adds ~42 paise ($0.005) on top of Meta fees.
-- Tenant charge = round(wholesale × 1.6)

ALTER TABLE "WhatsAppPricing" ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'meta';

ALTER TABLE "WhatsAppPricing" DROP CONSTRAINT IF EXISTS "WhatsAppPricing_country_currency_category_key";
DROP INDEX IF EXISTS "WhatsAppPricing_country_currency_category_key";

ALTER TABLE "WhatsAppPricing" DROP CONSTRAINT IF EXISTS "WhatsAppPricing_country_currency_category_provider_key";
DROP INDEX IF EXISTS "WhatsAppPricing_country_currency_category_provider_key";

ALTER TABLE "WhatsAppPricing"
  ADD CONSTRAINT "WhatsAppPricing_country_currency_category_provider_key"
  UNIQUE ("country", "currency", "category", "provider");

-- Re-seed Meta rows at 1.6× (80 / 136 / 64 / 48)
UPDATE "WhatsAppPricing" SET "provider" = 'meta', "pricePaise" = 80, "active" = true
  WHERE "country" = 'IN' AND "currency" = 'INR' AND "category" = 'UTILITY';
UPDATE "WhatsAppPricing" SET "provider" = 'meta', "pricePaise" = 136, "active" = true
  WHERE "country" = 'IN' AND "currency" = 'INR' AND "category" = 'MARKETING';
UPDATE "WhatsAppPricing" SET "provider" = 'meta', "pricePaise" = 64, "active" = true
  WHERE "country" = 'IN' AND "currency" = 'INR' AND "category" = 'SERVICE';
UPDATE "WhatsAppPricing" SET "provider" = 'meta', "pricePaise" = 48, "active" = true
  WHERE "country" = 'IN' AND "currency" = 'INR' AND "category" = 'AUTHENTICATION';

-- Twilio rows at 1.6× (Meta + Twilio fee)
INSERT INTO "WhatsAppPricing" ("id", "country", "currency", "provider", "category", "pricePaise", "active", "createdAt") VALUES
('price_in_utility_twilio', 'IN', 'INR', 'twilio', 'UTILITY', 147, true, CURRENT_TIMESTAMP),
('price_in_marketing_twilio', 'IN', 'INR', 'twilio', 'MARKETING', 203, true, CURRENT_TIMESTAMP),
('price_in_service_twilio', 'IN', 'INR', 'twilio', 'SERVICE', 131, true, CURRENT_TIMESTAMP),
('price_in_authentication_twilio', 'IN', 'INR', 'twilio', 'AUTHENTICATION', 115, true, CURRENT_TIMESTAMP)
ON CONFLICT ("country", "currency", "category", "provider") DO UPDATE SET
  "pricePaise" = EXCLUDED."pricePaise",
  "active" = true;
