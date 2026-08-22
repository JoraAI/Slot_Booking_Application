-- Tenant WhatsApp wallet prices: 2× markup over previous seeded Meta-modeled costs.
-- Same y messages for clients → charge 2x. Update in place for DBs that already seeded 1x.

UPDATE "WhatsAppPricing" SET "pricePaise" = 100 WHERE "id" = 'price_in_utility' AND "pricePaise" = 50;
UPDATE "WhatsAppPricing" SET "pricePaise" = 170 WHERE "id" = 'price_in_marketing' AND "pricePaise" = 85;
UPDATE "WhatsAppPricing" SET "pricePaise" = 80 WHERE "id" = 'price_in_service' AND "pricePaise" = 40;
UPDATE "WhatsAppPricing" SET "pricePaise" = 60 WHERE "id" = 'price_in_authentication' AND "pricePaise" = 30;
