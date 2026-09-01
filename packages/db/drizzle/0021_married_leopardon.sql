ALTER TABLE "grants" ADD COLUMN "apply_method" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "grants" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "grants" ADD COLUMN "mailing_address" text;--> statement-breakpoint
ALTER TABLE "grant_candidates" ADD COLUMN "extraction" jsonb;--> statement-breakpoint
ALTER TABLE "grant_candidates" ADD COLUMN "extracted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "grant_candidates" ADD COLUMN "rejection_kind" text;--> statement-breakpoint
ALTER TABLE "grant_candidates" ADD COLUMN "review_note" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_candidates_rejection_kind_idx" ON "grant_candidates" USING btree ("rejection_kind");