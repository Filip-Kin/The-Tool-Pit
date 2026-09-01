CREATE TABLE IF NOT EXISTS "practice_field_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"source_id" uuid,
	"source_url" text NOT NULL,
	"canonical_url" text,
	"team_number" integer,
	"raw_metadata" jsonb,
	"extracted" jsonb,
	"confidence_score" real,
	"status" text DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"matched_field_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "practice_field_crawl_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"connector" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"stats" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "practice_field_crawl_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"target" text NOT NULL,
	"config" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"cadence_hours" integer DEFAULT 168 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"yield_count" integer DEFAULT 0 NOT NULL,
	"reject_count" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_listing_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"source_id" uuid,
	"source_url" text NOT NULL,
	"canonical_url" text,
	"tba_key" text,
	"raw_metadata" jsonb,
	"extracted" jsonb,
	"confidence_score" real,
	"status" text DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"matched_listing_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_listing_crawl_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"connector" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"stats" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_listing_crawl_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"target" text NOT NULL,
	"config" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"cadence_hours" integer DEFAULT 24 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"yield_count" integer DEFAULT 0 NOT NULL,
	"reject_count" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "practice_field_candidates" ADD CONSTRAINT "practice_field_candidates_job_id_practice_field_crawl_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."practice_field_crawl_jobs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "practice_field_candidates" ADD CONSTRAINT "practice_field_candidates_source_id_practice_field_crawl_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."practice_field_crawl_sources"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "practice_field_candidates" ADD CONSTRAINT "practice_field_candidates_matched_field_id_practice_fields_id_fk" FOREIGN KEY ("matched_field_id") REFERENCES "public"."practice_fields"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "practice_field_crawl_jobs" ADD CONSTRAINT "practice_field_crawl_jobs_source_id_practice_field_crawl_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."practice_field_crawl_sources"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_listing_candidates" ADD CONSTRAINT "event_listing_candidates_job_id_event_listing_crawl_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."event_listing_crawl_jobs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_listing_candidates" ADD CONSTRAINT "event_listing_candidates_source_id_event_listing_crawl_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."event_listing_crawl_sources"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_listing_candidates" ADD CONSTRAINT "event_listing_candidates_matched_listing_id_event_listings_id_fk" FOREIGN KEY ("matched_listing_id") REFERENCES "public"."event_listings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_listing_crawl_jobs" ADD CONSTRAINT "event_listing_crawl_jobs_source_id_event_listing_crawl_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."event_listing_crawl_sources"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "practice_field_candidates_job_idx" ON "practice_field_candidates" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "practice_field_candidates_status_idx" ON "practice_field_candidates" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "practice_field_candidates_canonical_url_idx" ON "practice_field_candidates" USING btree ("canonical_url");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "practice_field_candidates_team_number_idx" ON "practice_field_candidates" USING btree ("team_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "practice_field_crawl_jobs_connector_idx" ON "practice_field_crawl_jobs" USING btree ("connector");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "practice_field_crawl_jobs_status_idx" ON "practice_field_crawl_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "practice_field_crawl_jobs_created_at_idx" ON "practice_field_crawl_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "practice_field_crawl_sources_kind_idx" ON "practice_field_crawl_sources" USING btree ("kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "practice_field_crawl_sources_enabled_idx" ON "practice_field_crawl_sources" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_listing_candidates_job_idx" ON "event_listing_candidates" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_listing_candidates_status_idx" ON "event_listing_candidates" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_listing_candidates_canonical_url_idx" ON "event_listing_candidates" USING btree ("canonical_url");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_listing_candidates_tba_key_idx" ON "event_listing_candidates" USING btree ("tba_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_listing_crawl_jobs_connector_idx" ON "event_listing_crawl_jobs" USING btree ("connector");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_listing_crawl_jobs_status_idx" ON "event_listing_crawl_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_listing_crawl_jobs_created_at_idx" ON "event_listing_crawl_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_listing_crawl_sources_kind_idx" ON "event_listing_crawl_sources" USING btree ("kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_listing_crawl_sources_enabled_idx" ON "event_listing_crawl_sources" USING btree ("enabled");