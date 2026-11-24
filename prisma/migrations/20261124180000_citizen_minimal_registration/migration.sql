BEGIN;

ALTER TABLE "users"
  ALTER COLUMN "firstName" DROP NOT NULL,
  ALTER COLUMN "phone" DROP NOT NULL,
  ADD CONSTRAINT "users_staff_profile_required" CHECK (
    "role" = 'CITIZEN' OR ("firstName" IS NOT NULL AND "phone" IS NOT NULL)
  );

COMMIT;
