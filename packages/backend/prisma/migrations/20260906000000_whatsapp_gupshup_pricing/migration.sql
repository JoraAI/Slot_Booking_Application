-- Seed Gupshup wallet pricing at Meta 1.6× rates (adjust via internal API if wholesale differs).
INSERT INTO "WhatsAppPricing" ("id", "country", "currency", "provider", "category", "pricePaise", "active", "createdAt") VALUES
('price_in_utility_gupshup', 'IN', 'INR', 'gupshup', 'UTILITY', 80, true, CURRENT_TIMESTAMP),
('price_in_marketing_gupshup', 'IN', 'INR', 'gupshup', 'MARKETING', 136, true, CURRENT_TIMESTAMP),
('price_in_service_gupshup', 'IN', 'INR', 'gupshup', 'SERVICE', 64, true, CURRENT_TIMESTAMP),
('price_in_authentication_gupshup', 'IN', 'INR', 'gupshup', 'AUTHENTICATION', 48, true, CURRENT_TIMESTAMP)
ON CONFLICT ("country", "currency", "category", "provider") DO UPDATE SET
  "pricePaise" = EXCLUDED."pricePaise",
  "active" = true;
