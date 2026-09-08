ALTER TABLE "event_listings" ADD COLUMN "registration_url_day2" text;--> statement-breakpoint
ALTER TABLE "event_listings" ADD COLUMN "tba_key_day2" text;--> statement-breakpoint
ALTER TABLE "event_listings" ADD COLUMN "team_list_url_day2" text;--> statement-breakpoint
ALTER TABLE "event_listings" ADD COLUMN "manual_team_list_text_day2" text;--> statement-breakpoint
ALTER TABLE "event_roster_snapshots" ADD COLUMN "day" integer;