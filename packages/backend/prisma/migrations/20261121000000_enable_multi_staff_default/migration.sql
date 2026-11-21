-- Multi-staff is on by default for new salons (Staff + Attendance menu).
ALTER TABLE "Business" ALTER COLUMN "enableMultiStaff" SET DEFAULT true;
