-- Corrective migration (Batch 1A): allow both default reminder offsets
-- (1,440 min and 120 min) to coexist per booking/channel/reminder-type.
--
-- Existing rows are handled safely: we add `offsetMinutes` as NULLABLE and
-- intentionally do NOT infer old offsets via timezone arithmetic in SQL
-- (unreliable across DST and per-business IANA timezones). Legacy rows keep
-- NULL offsetMinutes; PostgreSQL unique indexes treat NULLs as distinct, so
-- legacy rows never collide with newly scheduled rows. Legacy rows remain
-- sendable (processDue) and cancellable (cancelForBooking); a reschedule or
-- cancellation recreates reminders with explicit offsets.

-- AlterTable
ALTER TABLE "BookingReminder" ADD COLUMN "offsetMinutes" INTEGER;

-- DropIndex (old defective unique key omitted the offset)
DROP INDEX IF EXISTS "BookingReminder_bookingId_channel_reminderType_key";

-- CreateIndex (new unique key includes the offset)
-- Name kept to Prisma's generated 63-char form (Prisma preserves the `_key`
-- suffix and truncates the middle: offsetMinutes -> offsetMinute).
CREATE UNIQUE INDEX "BookingReminder_bookingId_channel_reminderType_offsetMinute_key" ON "BookingReminder"("bookingId", "channel", "reminderType", "offsetMinutes");
