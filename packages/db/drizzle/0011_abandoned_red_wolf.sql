CREATE TABLE IF NOT EXISTS "event_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program" text DEFAULT 'frc' NOT NULL,
	"name" text NOT NULL,
	"host_team_number" integer,
	"latitude" double precision,
	"longitude" double precision,
	"venue_name" text,
	"address" text,
	"city" text,
	"region" text,
	"country" text,
	"start_date" date,
	"end_date" date,
	"days" integer,
	"parallel_divisions" boolean DEFAULT false NOT NULL,
	"capacity" integer,
	"cost_usd" integer,
	"cost_note" text,
	"registration_status" text DEFAULT 'unknown' NOT NULL,
	"registration_opens_at" date,
	"volunteer_status" text DEFAULT 'unknown' NOT NULL,
	"event_status" text DEFAULT 'confirmed' NOT NULL,
	"website" text,
	"registration_url" text,
	"chief_delphi_url" text,
	"contact_email" text,
	"notes" text,
	"tba_key" text,
	"registered_team_count" integer,
	"team_count_updated_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"source" text DEFAULT 'submission' NOT NULL,
	"rejection_reason" text,
	"submitter_name" text,
	"submitter_contact" text,
	"submitter_ip_hash" text,
	"submitted_by_user_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_roster_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_listing_id" uuid NOT NULL,
	"source_url" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"http_status" integer,
	"team_count" integer,
	"teams" jsonb,
	"content_hash" text,
	"changed" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_listings" ADD CONSTRAINT "event_listings_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_roster_snapshots" ADD CONSTRAINT "event_roster_snapshots_event_listing_id_event_listings_id_fk" FOREIGN KEY ("event_listing_id") REFERENCES "public"."event_listings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_listings_status_idx" ON "event_listings" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_listings_program_idx" ON "event_listings" USING btree ("program");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_listings_start_date_idx" ON "event_listings" USING btree ("start_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_listings_event_status_idx" ON "event_listings" USING btree ("event_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_listings_tba_key_idx" ON "event_listings" USING btree ("tba_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_roster_snapshots_listing_idx" ON "event_roster_snapshots" USING btree ("event_listing_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_roster_snapshots_status_idx" ON "event_roster_snapshots" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_roster_snapshots_fetched_at_idx" ON "event_roster_snapshots" USING btree ("fetched_at");