-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "managementTokenHash" TEXT;

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "bookingManagementOtpChannel" TEXT,
ADD COLUMN     "bookingManagementOtpEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BookingManagementOtp" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "destinationHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "requesterIp" TEXT,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingManagementOtp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingManagementSession" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "sessionTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingManagementSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingManagementOtp_bookingId_consumedAt_idx" ON "BookingManagementOtp"("bookingId", "consumedAt");

-- CreateIndex
CREATE INDEX "BookingManagementOtp_businessId_idx" ON "BookingManagementOtp"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingManagementSession_sessionTokenHash_key" ON "BookingManagementSession"("sessionTokenHash");

-- CreateIndex
CREATE INDEX "BookingManagementSession_bookingId_idx" ON "BookingManagementSession"("bookingId");

-- CreateIndex
CREATE INDEX "BookingManagementSession_expiresAt_idx" ON "BookingManagementSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "BookingManagementOtp" ADD CONSTRAINT "BookingManagementOtp_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingManagementOtp" ADD CONSTRAINT "BookingManagementOtp_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingManagementSession" ADD CONSTRAINT "BookingManagementSession_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

