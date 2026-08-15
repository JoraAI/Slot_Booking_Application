-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('INITIATING', 'PENDING', 'VERIFIED', 'CONSUMED', 'EXPIRED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "razorpayOrderId" TEXT,
    "businessId" TEXT NOT NULL,
    "serviceId" TEXT,
    "staffId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "occupiedEndTime" TEXT NOT NULL,
    "customerData" JSONB NOT NULL,
    "formData" JSONB NOT NULL,
    "originalPrice" DOUBLE PRECISION NOT NULL,
    "discountAmount" DOUBLE PRECISION NOT NULL,
    "finalPrice" DOUBLE PRECISION NOT NULL,
    "payableMinor" INTEGER NOT NULL,
    "paymentMode" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'INITIATING',
    "holdExpiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "bookingId" TEXT,
    "source" "BookingSource" NOT NULL DEFAULT 'DIRECT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_razorpayOrderId_key" ON "PaymentAttempt"("razorpayOrderId");

-- CreateIndex
CREATE INDEX "PaymentAttempt_businessId_status_holdExpiresAt_idx" ON "PaymentAttempt"("businessId", "status", "holdExpiresAt");

-- CreateIndex
CREATE INDEX "PaymentAttempt_businessId_serviceId_status_idx" ON "PaymentAttempt"("businessId", "serviceId", "status");

-- CreateIndex
CREATE INDEX "PaymentAttempt_businessId_date_startTime_idx" ON "PaymentAttempt"("businessId", "date", "startTime");

-- CreateIndex
CREATE INDEX "PaymentAttempt_businessId_staffId_idx" ON "PaymentAttempt"("businessId", "staffId");

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

