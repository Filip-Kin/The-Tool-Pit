ALTER TABLE "submissions" ADD COLUMN "submitter_owns" boolean;--> statement-breakpoint
ALTER TABLE "album_submissions" ADD COLUMN "submitter_owns" boolean;--> statement-breakpoint
ALTER TABLE "practice_fields" ADD COLUMN "submitter_owns" boolean;--> statement-breakpoint
ALTER TABLE "event_listings" ADD COLUMN "submitter_owns" boolean;--> statement-breakpoint
ALTER TABLE "grant_candidates" ADD COLUMN "submitter_owns" boolean;