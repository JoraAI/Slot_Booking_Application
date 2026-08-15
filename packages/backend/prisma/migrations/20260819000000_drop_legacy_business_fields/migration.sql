-- Drop business-level legacy booking knobs superseded by per-service
-- duration, capacity, and price.
ALTER TABLE "Business" DROP COLUMN IF EXISTS "parallelSeats";
ALTER TABLE "Business" DROP COLUMN IF EXISTS "slotDurationMinutes";
ALTER TABLE "Business" DROP COLUMN IF EXISTS "servicePrice";
