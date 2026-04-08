ALTER TABLE "tools" ADD COLUMN "is_team_cad" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tools" ADD COLUMN "github_stars" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tools" ADD COLUMN "chief_delphi_likes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tools" ADD COLUMN "admin_notes" text;--> statement-breakpoint
ALTER TABLE "crawl_candidates" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tools_is_team_cad_idx" ON "tools" USING btree ("is_team_cad");