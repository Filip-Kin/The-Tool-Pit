CREATE TABLE IF NOT EXISTS "event_edit_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_listing_id" uuid NOT NULL,
	"proposed" jsonb NOT NULL,
	"note" text,
	"submitter_name" text,
	"submitter_contact" text,
	"submitter_ip_hash" text,
	"submitted_by_user_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_edit_proposals" ADD CONSTRAINT "event_edit_proposals_event_listing_id_event_listings_id_fk" FOREIGN KEY ("event_listing_id") REFERENCES "public"."event_listings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_edit_proposals" ADD CONSTRAINT "event_edit_proposals_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_edit_proposals_event_listing_id_idx" ON "event_edit_proposals" USING btree ("event_listing_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_edit_proposals_status_idx" ON "event_edit_proposals" USING btree ("status");