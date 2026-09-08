-- Multi-shop orgs + Owner/Manager roles

CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'MANAGER');

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "googleSub" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrgMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrgMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BusinessMembership" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BusinessMembership_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Business" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Business" ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT true;

-- Drop Business.googleSub unique so identity moves to User (values copied below).
DROP INDEX IF EXISTS "Business_googleSub_key";

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");
CREATE UNIQUE INDEX "OrgMember_organizationId_userId_key" ON "OrgMember"("organizationId", "userId");
CREATE INDEX "OrgMember_userId_idx" ON "OrgMember"("userId");
CREATE UNIQUE INDEX "BusinessMembership_businessId_userId_key" ON "BusinessMembership"("businessId", "userId");
CREATE INDEX "BusinessMembership_userId_idx" ON "BusinessMembership"("userId");
CREATE INDEX "Business_organizationId_idx" ON "Business"("organizationId");

ALTER TABLE "OrgMember" ADD CONSTRAINT "OrgMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrgMember" ADD CONSTRAINT "OrgMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessMembership" ADD CONSTRAINT "BusinessMembership_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessMembership" ADD CONSTRAINT "BusinessMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one Organization + User per existing Business; same email reuses User and joins shops under one org when possible.
DO $$
DECLARE
  b RECORD;
  uid TEXT;
  oid TEXT;
  existing_user_id TEXT;
  existing_org_id TEXT;
BEGIN
  FOR b IN SELECT * FROM "Business" WHERE "organizationId" IS NULL ORDER BY "createdAt" ASC LOOP
    SELECT u.id INTO existing_user_id FROM "User" u WHERE lower(u.email) = lower(b."ownerEmail") LIMIT 1;

    IF existing_user_id IS NULL THEN
      uid := replace(gen_random_uuid()::text, '-', '');
      -- cuid-like: use 'c' prefix + hex for readability
      uid := 'c' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24);
      INSERT INTO "User" ("id", "email", "passwordHash", "googleSub", "emailVerifiedAt", "createdAt", "updatedAt")
      VALUES (
        uid,
        lower(trim(b."ownerEmail")),
        b."ownerPassword",
        b."googleSub",
        b."emailVerifiedAt",
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      );
    ELSE
      uid := existing_user_id;
      UPDATE "User" SET
        "passwordHash" = COALESCE("passwordHash", b."ownerPassword"),
        "googleSub" = COALESCE("googleSub", b."googleSub"),
        "emailVerifiedAt" = COALESCE("emailVerifiedAt", b."emailVerifiedAt"),
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = uid;
    END IF;

    SELECT om."organizationId" INTO existing_org_id
    FROM "OrgMember" om
    WHERE om."userId" = uid AND om.role = 'OWNER'
    ORDER BY om."createdAt" ASC
    LIMIT 1;

    IF existing_org_id IS NULL THEN
      oid := 'c' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24);
      INSERT INTO "Organization" ("id", "name", "createdAt", "updatedAt")
      VALUES (oid, b.name, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      INSERT INTO "OrgMember" ("id", "organizationId", "userId", "role", "createdAt")
      VALUES ('c' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24), oid, uid, 'OWNER', CURRENT_TIMESTAMP);
    ELSE
      oid := existing_org_id;
    END IF;

    UPDATE "Business"
    SET "organizationId" = oid,
        "isPrimary" = (existing_org_id IS NULL)
    WHERE id = b.id;

    INSERT INTO "BusinessMembership" ("id", "businessId", "userId", "role", "createdAt")
    VALUES (
      'c' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
      b.id,
      uid,
      'OWNER',
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("businessId", "userId") DO NOTHING;
  END LOOP;
END $$;

ALTER TABLE "Business" ADD CONSTRAINT "Business_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
