-- Tenant WhatsApp wallet prices: 1.2× modeled wholesale (was 1.6×).
-- Meta wholesale (IN paise): UTILITY 50, MARKETING 85, SERVICE 40, AUTH 30
-- Twilio wholesale = Meta + ~42 paise ($0.005)
-- Tenant charge = round(wholesale × 1.2)

-- Meta / Gupshup at 1.2× (60 / 102 / 48 / 36)
UPDATE "WhatsAppPricing" SET "pricePaise" = 60, "active" = true
  WHERE "country" = 'IN' AND "currency" = 'INR' AND "category" = 'UTILITY' AND "provider" IN ('meta', 'gupshup');
UPDATE "WhatsAppPricing" SET "pricePaise" = 102, "active" = true
  WHERE "country" = 'IN' AND "currency" = 'INR' AND "category" = 'MARKETING' AND "provider" IN ('meta', 'gupshup');
UPDATE "WhatsAppPricing" SET "pricePaise" = 48, "active" = true
  WHERE "country" = 'IN' AND "currency" = 'INR' AND "category" = 'SERVICE' AND "provider" IN ('meta', 'gupshup');
UPDATE "WhatsAppPricing" SET "pricePaise" = 36, "active" = true
  WHERE "country" = 'IN' AND "currency" = 'INR' AND "category" = 'AUTHENTICATION' AND "provider" IN ('meta', 'gupshup');

-- Twilio at 1.2× (110 / 152 / 98 / 86)
UPDATE "WhatsAppPricing" SET "pricePaise" = 110, "active" = true
  WHERE "country" = 'IN' AND "currency" = 'INR' AND "category" = 'UTILITY' AND "provider" = 'twilio';
UPDATE "WhatsAppPricing" SET "pricePaise" = 152, "active" = true
  WHERE "country" = 'IN' AND "currency" = 'INR' AND "category" = 'MARKETING' AND "provider" = 'twilio';
UPDATE "WhatsAppPricing" SET "pricePaise" = 98, "active" = true
  WHERE "country" = 'IN' AND "currency" = 'INR' AND "category" = 'SERVICE' AND "provider" = 'twilio';
UPDATE "WhatsAppPricing" SET "pricePaise" = 86, "active" = true
  WHERE "country" = 'IN' AND "currency" = 'INR' AND "category" = 'AUTHENTICATION' AND "provider" = 'twilio';
