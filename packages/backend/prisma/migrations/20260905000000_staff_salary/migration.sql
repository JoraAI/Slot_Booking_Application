-- Optional staff salary (owner dashboard only; never exposed on public routes).
ALTER TABLE "Staff" ADD COLUMN "salary" DOUBLE PRECISION;
