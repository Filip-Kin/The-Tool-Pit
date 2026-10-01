CREATE TABLE IF NOT EXISTS "listing_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"column" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"quote" text,
	"source_url" text,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_changes_entity_idx" ON "listing_changes" USING btree ("entity_type","entity_id","created_at");