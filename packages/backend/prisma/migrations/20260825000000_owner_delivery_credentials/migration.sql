-- Per-owner SMTP and Twilio credentials. Passwords/tokens are stored encrypted.
ALTER TABLE "Business"
  ADD COLUMN "smtpHost" TEXT,
  ADD COLUMN "smtpPort" INTEGER,
  ADD COLUMN "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "smtpUser" TEXT,
  ADD COLUMN "smtpPassEnc" TEXT,
  ADD COLUMN "smtpFromName" TEXT,
  ADD COLUMN "twilioAccountSid" TEXT,
  ADD COLUMN "twilioAuthTokenEnc" TEXT,
  ADD COLUMN "twilioWhatsappFrom" TEXT,
  ADD COLUMN "twilioSmsFrom" TEXT;
