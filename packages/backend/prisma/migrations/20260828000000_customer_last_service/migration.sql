-- Last booked service on the contact book, plus lookup indexes for email/phone merge.
ALTER TABLE "CustomerContact" ADD COLUMN "lastServiceName" TEXT;

CREATE INDEX "CustomerContact_businessId_phone_idx" ON "CustomerContact"("businessId", "phone");
CREATE INDEX "CustomerContact_businessId_email_idx" ON "CustomerContact"("businessId", "email");

-- Backfill from each customer's most recent booking that matches phone or email.
UPDATE "CustomerContact" c
SET "lastServiceName" = latest."serviceNameSnapshot"
FROM (
  SELECT DISTINCT ON (c2."id")
    c2."id" AS "contactId",
    b."serviceNameSnapshot"
  FROM "CustomerContact" c2
  JOIN "Booking" b
    ON b."businessId" = c2."businessId"
   AND (
     (c2."phone" IS NOT NULL AND NULLIF(TRIM(b."customerPhone"), '') IS NOT NULL
       AND REGEXP_REPLACE(b."customerPhone", '[^0-9+]', '', 'g') = REGEXP_REPLACE(c2."phone", '[^0-9+]', '', 'g'))
     OR
     (c2."email" IS NOT NULL AND NULLIF(TRIM(b."customerEmail"), '') IS NOT NULL
       AND LOWER(TRIM(b."customerEmail")) = LOWER(TRIM(c2."email")))
   )
  WHERE b."serviceNameSnapshot" IS NOT NULL
  ORDER BY c2."id", b."createdAt" DESC
) latest
WHERE c."id" = latest."contactId"
  AND c."lastServiceName" IS NULL;
