-- Owner Google Sign-In + email OTP (signup + forgot-password).
-- Non-breaking: existing ownerPassword values stay; login unchanged.
-- ownerPassword becomes nullable (Google-only accounts); existing rows keep it.

-- AlterTable: Business
ALTER TABLE "Business" ALTER COLUMN "ownerPassword" DROP NOT NULL;
ALTER TABLE "Business" ADD COLUMN "googleSub" TEXT,
ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Business_googleSub_key" ON "Business"("googleSub");

-- CreateTable
CREATE TABLE "OwnerAuthOtp" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "consumedAt" TIMESTAMP(3),
    "requesterIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerAuthOtp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OwnerAuthOtp_email_purpose_createdAt_idx" ON "OwnerAuthOtp"("email", "purpose", "createdAt");
