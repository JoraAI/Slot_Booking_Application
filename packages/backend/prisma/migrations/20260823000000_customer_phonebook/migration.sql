-- Per-business customer phonebook, automatically synchronized from bookings.
CREATE TABLE "CustomerContact" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "bookingCount" INTEGER NOT NULL DEFAULT 0,
    "lastBookedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerContact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerNotification" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT,
    "channel" TEXT NOT NULL,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "recipientEmail" TEXT,
    "recipientPhone" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerContact_businessId_identityKey_key"
ON "CustomerContact"("businessId", "identityKey");
CREATE INDEX "CustomerContact_businessId_name_idx"
ON "CustomerContact"("businessId", "name");
CREATE INDEX "CustomerContact_businessId_updatedAt_idx"
ON "CustomerContact"("businessId", "updatedAt");
CREATE INDEX "CustomerNotification_businessId_createdAt_idx"
ON "CustomerNotification"("businessId", "createdAt");
CREATE INDEX "CustomerNotification_businessId_status_idx"
ON "CustomerNotification"("businessId", "status");
CREATE INDEX "CustomerNotification_customerId_idx"
ON "CustomerNotification"("customerId");

ALTER TABLE "CustomerContact"
ADD CONSTRAINT "CustomerContact_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerNotification"
ADD CONSTRAINT "CustomerNotification_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerNotification"
ADD CONSTRAINT "CustomerNotification_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "CustomerContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Populate the phonebook from existing bookings. Email is the primary identity;
-- phone is used when email is absent. The most recently updated booking supplies
-- the display data, while bookingCount and lastBookedAt aggregate all matches.
WITH normalized AS (
    SELECT
        b.*,
        CASE
            WHEN NULLIF(TRIM(b."customerPhone"), '') IS NOT NULL
                THEN 'phone:' || REGEXP_REPLACE(b."customerPhone", '[^0-9+]', '', 'g')
            ELSE 'email:' || LOWER(TRIM(b."customerEmail"))
        END AS identity_key
    FROM "Booking" b
),
aggregated AS (
    SELECT
        "businessId",
        identity_key,
        COUNT(*)::INTEGER AS booking_count,
        MAX("createdAt") AS last_booked_at,
        MIN("createdAt") AS first_booked_at
    FROM normalized
    GROUP BY "businessId", identity_key
),
latest AS (
    SELECT DISTINCT ON ("businessId", identity_key)
        "businessId",
        identity_key,
        "customerName",
        NULLIF(TRIM("customerPhone"), '') AS phone,
        NULLIF(TRIM("customerEmail"), '') AS email,
        "updatedAt"
    FROM normalized
    ORDER BY "businessId", identity_key, "updatedAt" DESC
)
INSERT INTO "CustomerContact" (
    "id", "businessId", "identityKey", "name", "phone", "email",
    "bookingCount", "lastBookedAt", "createdAt", "updatedAt"
)
SELECT
    'legacy_' || MD5(a."businessId" || ':' || a.identity_key),
    a."businessId",
    a.identity_key,
    l."customerName",
    l.phone,
    l.email,
    a.booking_count,
    a.last_booked_at,
    a.first_booked_at,
    l."updatedAt"
FROM aggregated a
JOIN latest l
  ON l."businessId" = a."businessId"
 AND l.identity_key = a.identity_key;
