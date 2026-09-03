ALTER TABLE "event_listings" ADD COLUMN "team_list_mode" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_listings" ADD COLUMN "manual_team_list_text" text;