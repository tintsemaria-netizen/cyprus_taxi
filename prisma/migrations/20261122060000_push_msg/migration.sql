-- Notification text key + values (2026-11-22): the phone shows the notification in the app's /
-- phone's language from this key; title/body stay the English fallback.
ALTER TABLE "NotificationOutbox" ADD COLUMN "msg" JSONB;
