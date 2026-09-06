-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "discountType" "DiscountType",
ADD COLUMN "discountValue" DOUBLE PRECISION,
ADD COLUMN "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
