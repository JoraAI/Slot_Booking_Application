-- Batch 4: salon location on Business (address + optional lat/lng pair).
-- Directions links are generated server-side (no Maps API key / geocoding).
ALTER TABLE "Business" ADD COLUMN "address" TEXT;
ALTER TABLE "Business" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "Business" ADD COLUMN "longitude" DOUBLE PRECISION;
