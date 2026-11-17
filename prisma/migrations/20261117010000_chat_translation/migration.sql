-- Driver↔passenger chat auto-translation (2026-11-17): the sender's UI language and a cache of
-- translations by target language, so each message is translated at most once per language.
ALTER TABLE "ChatMessage" ADD COLUMN "lang" TEXT;
ALTER TABLE "ChatMessage" ADD COLUMN "translations" JSONB;
