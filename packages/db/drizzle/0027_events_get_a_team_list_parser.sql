ALTER TABLE "event_listings" ADD COLUMN "team_list_parser" text;--> statement-breakpoint
ALTER TABLE "event_listings" ADD COLUMN "team_list_parser_source_url" text;--> statement-breakpoint
ALTER TABLE "event_listings" ADD COLUMN "team_list_parser_updated_at" timestamp with time zone;