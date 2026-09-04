ALTER TABLE "event_listings" ADD COLUMN "host_team_numbers" integer[];
--> statement-breakpoint
UPDATE "event_listings" SET "host_team_numbers" = ARRAY["host_team_number"] WHERE "host_team_number" IS NOT NULL AND "host_team_numbers" IS NULL;