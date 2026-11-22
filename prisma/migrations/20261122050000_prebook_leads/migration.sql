-- Pre-booking lead times (2026-11-22, operator): a pre-booking at least 1 h ahead, with a co-rider at least 3 h,
-- the share board hides a ride 4 h before pickup. Settings are a JSON text row; only raise a lower saved value.
UPDATE "Setting" SET "value" = jsonb_set("value"::jsonb, '{scheduleMinMinutes}', '60')::text
WHERE "key" = 'operational' AND COALESCE(("value"::jsonb ->> 'scheduleMinMinutes')::int, 0) < 60;
