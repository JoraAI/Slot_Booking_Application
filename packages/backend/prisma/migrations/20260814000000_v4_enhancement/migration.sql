-- Enable pgcrypto for cryptographically secure random backfill
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- CreateEnum
CREATE TYPE "ServiceResourceMode" AS ENUM ('STAFF_BASED', 'POOLED');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FLAT');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('DIRECT', 'QR', 'EMBED', 'WIDGET');

-- CreateEnum
CREATE TYPE "PageSectionType" AS ENUM ('HERO', 'OFFERS', 'GALLERY', 'ABOUT', 'SERVICES', 'BUSINESS_HOURS', 'WHY_CHOOSE_US', 'TESTIMONIALS', 'CONTACT', 'CUSTOM_TEXT');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "bufferMinutesSnapshot" INTEGER,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'INR',
ADD COLUMN     "discountAmount" DOUBLE PRECISION,
ADD COLUMN     "durationMinutesSnapshot" INTEGER,
ADD COLUMN     "finalPrice" DOUBLE PRECISION,
ADD COLUMN     "originalPrice" DOUBLE PRECISION,
ADD COLUMN     "serviceId" TEXT,
ADD COLUMN     "serviceNameSnapshot" TEXT,
ADD COLUMN     "source" "BookingSource" NOT NULL DEFAULT 'DIRECT';

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "accentColor" TEXT,
ADD COLUMN     "coverImagePublicId" TEXT,
ADD COLUMN     "coverImageUrl" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "logoPublicId" TEXT,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "primaryColor" TEXT NOT NULL DEFAULT '#7C3AED',
ADD COLUMN     "publicCode" TEXT,
ADD COLUMN     "reminderOffsetsMinutes" INTEGER[] DEFAULT ARRAY[1440, 120]::INTEGER[],
ADD COLUMN     "remindersEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "secondaryColor" TEXT,
ADD COLUMN     "slotGranularityMinutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata';

-- Backfill secure, URL-safe public codes (base64url of 16 random bytes, 96+ bits entropy)
UPDATE "Business"
SET "publicCode" = translate(encode(gen_random_bytes(16), 'base64'), E'+/=\n', '_-')
WHERE "publicCode" IS NULL;

ALTER TABLE "Business" ALTER COLUMN "publicCode" SET NOT NULL;

-- AlterTable
ALTER TABLE "WaitlistEntry" ADD COLUMN     "durationMinutesSnapshot" INTEGER,
ADD COLUMN     "serviceId" TEXT,
ADD COLUMN     "source" "BookingSource" NOT NULL DEFAULT 'DIRECT';

-- CreateTable
CREATE TABLE "ServiceCategory" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "imagePublicId" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "bufferMinutes" INTEGER NOT NULL DEFAULT 0,
    "price" DOUBLE PRECISION NOT NULL,
    "resourceMode" "ServiceResourceMode" NOT NULL DEFAULT 'POOLED',
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "imageUrl" TEXT,
    "imagePublicId" TEXT,
    "discountType" "DiscountType",
    "discountValue" DOUBLE PRECISION,
    "discountLabel" TEXT,
    "discountValidFrom" TIMESTAMP(3),
    "discountValidUntil" TIMESTAMP(3),
    "discountActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffService" (
    "staffId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffService_pkey" PRIMARY KEY ("staffId","serviceId")
);

-- CreateTable
CREATE TABLE "ServiceWorkingHour" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "openTime" TEXT NOT NULL,
    "closeTime" TEXT NOT NULL,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ServiceWorkingHour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffWorkingHour" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "openTime" TEXT NOT NULL,
    "closeTime" TEXT NOT NULL,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "StaffWorkingHour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageSection" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "type" "PageSectionType" NOT NULL,
    "title" TEXT,
    "content" TEXT,
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingReminder" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "reminderType" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceCategory_businessId_isActive_displayOrder_idx" ON "ServiceCategory"("businessId", "isActive", "displayOrder");

-- CreateIndex
CREATE INDEX "Service_businessId_categoryId_isActive_displayOrder_idx" ON "Service"("businessId", "categoryId", "isActive", "displayOrder");

-- CreateIndex
CREATE INDEX "StaffService_businessId_idx" ON "StaffService"("businessId");

-- CreateIndex
CREATE INDEX "ServiceWorkingHour_businessId_serviceId_dayOfWeek_idx" ON "ServiceWorkingHour"("businessId", "serviceId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "StaffWorkingHour_businessId_staffId_dayOfWeek_idx" ON "StaffWorkingHour"("businessId", "staffId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "PageSection_businessId_isVisible_displayOrder_idx" ON "PageSection"("businessId", "isVisible", "displayOrder");

-- CreateIndex
CREATE INDEX "BookingReminder_status_scheduledFor_idx" ON "BookingReminder"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "BookingReminder_businessId_idx" ON "BookingReminder"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingReminder_bookingId_channel_reminderType_key" ON "BookingReminder"("bookingId", "channel", "reminderType");

-- CreateIndex
CREATE INDEX "Booking_businessId_serviceId_status_idx" ON "Booking"("businessId", "serviceId", "status");

-- CreateIndex
CREATE INDEX "Booking_businessId_source_idx" ON "Booking"("businessId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "Business_publicCode_key" ON "Business"("publicCode");

-- AddForeignKey
ALTER TABLE "ServiceCategory" ADD CONSTRAINT "ServiceCategory_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffService" ADD CONSTRAINT "StaffService_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffService" ADD CONSTRAINT "StaffService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceWorkingHour" ADD CONSTRAINT "ServiceWorkingHour_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceWorkingHour" ADD CONSTRAINT "ServiceWorkingHour_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffWorkingHour" ADD CONSTRAINT "StaffWorkingHour_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffWorkingHour" ADD CONSTRAINT "StaffWorkingHour_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageSection" ADD CONSTRAINT "PageSection_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingReminder" ADD CONSTRAINT "BookingReminder_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingReminder" ADD CONSTRAINT "BookingReminder_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

