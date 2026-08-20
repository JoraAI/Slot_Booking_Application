-- Store form-derived attributes (gender, etc.) for broadcast targeting.
ALTER TABLE "CustomerContact" ADD COLUMN IF NOT EXISTS "attributes" JSONB NOT NULL DEFAULT '{}';
