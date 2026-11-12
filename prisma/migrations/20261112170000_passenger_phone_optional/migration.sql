-- Passengers may sign up with email + password only (phone optional until SMS verification
-- is available). Additive: existing rows keep their verified phone; the unique index still
-- applies to non-null phones.
ALTER TABLE "Passenger" ALTER COLUMN "phone" DROP NOT NULL;
