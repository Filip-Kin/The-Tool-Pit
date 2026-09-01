ALTER TABLE "tools" ADD COLUMN "human_edited_fields" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "field_edit_proposals" ADD COLUMN "rejection_reason" text;