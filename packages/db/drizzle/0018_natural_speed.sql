ALTER TABLE "event_listings" ADD COLUMN "season_year" integer;--> statement-breakpoint
ALTER TABLE "event_listings" ADD COLUMN "previous_listing_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_listings" ADD CONSTRAINT "event_listings_previous_listing_id_event_listings_id_fk" FOREIGN KEY ("previous_listing_id") REFERENCES "public"."event_listings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_listings_season_year_idx" ON "event_listings" USING btree ("season_year");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_listings_previous_listing_idx" ON "event_listings" USING btree ("previous_listing_id");--> statement-breakpoint
-- Backfill the season from the dates already on the row.
--
-- The offseason season is the calendar year, so this is a plain year extract
-- off start_date. It covers the 16 seeded FIM listings, every one of which
-- starts in 2026 and so becomes season 2026.
--
-- COALESCE to end_date for the shape where somebody filled in the last day and
-- not the first. A listing with no dates at all keeps a NULL season on purpose:
-- null is read as "current season" everywhere, so an undated listing stays on
-- the map instead of being archived by a guess.
UPDATE "event_listings"
SET "season_year" = EXTRACT(YEAR FROM COALESCE("start_date", "end_date"))::integer
WHERE "season_year" IS NULL
  AND COALESCE("start_date", "end_date") IS NOT NULL;
