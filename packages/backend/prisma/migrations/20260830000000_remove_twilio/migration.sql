-- Twilio is no longer used (WhatsApp = Meta Cloud API; booking OTP = email only).
ALTER TABLE "Business" DROP COLUMN IF EXISTS "twilioAccountSid";
ALTER TABLE "Business" DROP COLUMN IF EXISTS "twilioAuthTokenEnc";
ALTER TABLE "Business" DROP COLUMN IF EXISTS "twilioWhatsappFrom";
ALTER TABLE "Business" DROP COLUMN IF EXISTS "twilioSmsFrom";

-- Normalize any SMS / EITHER OTP channels to email-only.
UPDATE "Business"
SET "bookingManagementOtpChannel" = 'EMAIL'
WHERE "bookingManagementOtpChannel" IS NULL
   OR "bookingManagementOtpChannel" IN ('SMS', 'EITHER');
