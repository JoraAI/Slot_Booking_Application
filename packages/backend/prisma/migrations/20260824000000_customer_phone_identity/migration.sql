-- Use phone as the stable identity when present. This matches booking sync and
-- prevents a customer from splitting into two contacts when their email changes.
CREATE TEMP TABLE "_CustomerContactMerge" ON COMMIT DROP AS
SELECT
    "id",
    "businessId",
    CASE
        WHEN NULLIF(TRIM("phone"), '') IS NOT NULL
            THEN 'phone:' || REGEXP_REPLACE("phone", '[^0-9+]', '', 'g')
        ELSE 'email:' || LOWER(TRIM("email"))
    END AS "newKey",
    FIRST_VALUE("id") OVER (
        PARTITION BY "businessId",
        CASE
            WHEN NULLIF(TRIM("phone"), '') IS NOT NULL
                THEN 'phone:' || REGEXP_REPLACE("phone", '[^0-9+]', '', 'g')
            ELSE 'email:' || LOWER(TRIM("email"))
        END
        ORDER BY "updatedAt" DESC
    ) AS "keeperId",
    SUM("bookingCount") OVER (
        PARTITION BY "businessId",
        CASE
            WHEN NULLIF(TRIM("phone"), '') IS NOT NULL
                THEN 'phone:' || REGEXP_REPLACE("phone", '[^0-9+]', '', 'g')
            ELSE 'email:' || LOWER(TRIM("email"))
        END
    )::INTEGER AS "totalBookings",
    MAX("lastBookedAt") OVER (
        PARTITION BY "businessId",
        CASE
            WHEN NULLIF(TRIM("phone"), '') IS NOT NULL
                THEN 'phone:' || REGEXP_REPLACE("phone", '[^0-9+]', '', 'g')
            ELSE 'email:' || LOWER(TRIM("email"))
        END
    ) AS "latestBooking"
FROM "CustomerContact";

UPDATE "CustomerNotification" n
SET "customerId" = m."keeperId"
FROM "_CustomerContactMerge" m
WHERE n."customerId" = m."id"
  AND m."id" <> m."keeperId";

UPDATE "CustomerContact" c
SET
    "bookingCount" = m."totalBookings",
    "lastBookedAt" = m."latestBooking"
FROM "_CustomerContactMerge" m
WHERE c."id" = m."keeperId";

DELETE FROM "CustomerContact" c
USING "_CustomerContactMerge" m
WHERE c."id" = m."id"
  AND m."id" <> m."keeperId";

UPDATE "CustomerContact" c
SET "identityKey" = m."newKey"
FROM "_CustomerContactMerge" m
WHERE c."id" = m."keeperId";
