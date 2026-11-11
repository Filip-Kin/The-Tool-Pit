ALTER TABLE "teams" ADD COLUMN "district" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "district_year" integer;--> statement-breakpoint
ALTER TABLE "grants" ADD COLUMN "first_districts" text[] DEFAULT '{}' NOT NULL;