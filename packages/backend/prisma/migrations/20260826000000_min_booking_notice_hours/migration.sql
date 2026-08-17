-- Minimum hours from now before a customer can book a slot.
ALTER TABLE "Business" ADD COLUMN "minBookingNoticeHours" INTEGER NOT NULL DEFAULT 0;
