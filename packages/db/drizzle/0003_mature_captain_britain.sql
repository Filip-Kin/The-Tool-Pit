CREATE TABLE IF NOT EXISTS "event_teams" (
	"event_id" uuid NOT NULL,
	"team_number" integer NOT NULL,
	CONSTRAINT "event_teams_event_id_team_number_pk" PRIMARY KEY("event_id","team_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tba_key" text NOT NULL,
	"event_code" text NOT NULL,
	"year" integer NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"start_date" date,
	"end_date" date,
	"week" integer,
	"event_type" integer,
	"event_type_string" text,
	"city" text,
	"state_prov" text,
	"country" text,
	"venue" text,
	"website" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_tba_key_unique" UNIQUE("tba_key"),
	CONSTRAINT "events_code_year_uq" UNIQUE("event_code","year")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "album_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"source_url" text NOT NULL,
	"canonical_url" text,
	"provider" text,
	"target_event_code" text,
	"target_event_year" integer,
	"matched_event_id" uuid,
	"raw_metadata" jsonb,
	"classification" jsonb,
	"confidence_score" real,
	"status" text DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"submission_id" uuid,
	"matched_album_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "album_crawl_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"stats" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "album_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"album_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_url" text,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_metadata" jsonb,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "album_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"event_hint" text,
	"photographer_hint" text,
	"submitter_note" text,
	"submitter_ip_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolved_album_id" uuid,
	"pipeline_log" jsonb,
	"confidence_score" real,
	"spam_score" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "albums" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"provider" text DEFAULT 'other' NOT NULL,
	"source_type" text NOT NULL,
	"title" text,
	"photographer" text,
	"description" text,
	"cover_image_url" text,
	"photo_count" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "albums_canonical_url_uq" UNIQUE("canonical_url")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_teams" ADD CONSTRAINT "event_teams_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "album_candidates" ADD CONSTRAINT "album_candidates_job_id_album_crawl_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."album_crawl_jobs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "album_candidates" ADD CONSTRAINT "album_candidates_matched_event_id_events_id_fk" FOREIGN KEY ("matched_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "album_candidates" ADD CONSTRAINT "album_candidates_matched_album_id_albums_id_fk" FOREIGN KEY ("matched_album_id") REFERENCES "public"."albums"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "album_sources" ADD CONSTRAINT "album_sources_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "album_submissions" ADD CONSTRAINT "album_submissions_resolved_album_id_albums_id_fk" FOREIGN KEY ("resolved_album_id") REFERENCES "public"."albums"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "albums" ADD CONSTRAINT "albums_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_teams_team_number_idx" ON "event_teams" USING btree ("team_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_search_idx" ON "events" USING gin (to_tsvector('english', "name" || ' ' || "event_code"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_name_trgm_idx" ON "events" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_code_trgm_idx" ON "events" USING gin ("event_code" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_start_date_idx" ON "events" USING btree ("start_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_year_idx" ON "events" USING btree ("year");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "album_candidates_job_id_idx" ON "album_candidates" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "album_candidates_status_idx" ON "album_candidates" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "album_candidates_canonical_url_idx" ON "album_candidates" USING btree ("canonical_url");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "album_candidates_target_event_code_idx" ON "album_candidates" USING btree ("target_event_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "album_candidates_submission_id_idx" ON "album_candidates" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "album_crawl_jobs_connector_idx" ON "album_crawl_jobs" USING btree ("connector");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "album_crawl_jobs_status_idx" ON "album_crawl_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "album_crawl_jobs_created_at_idx" ON "album_crawl_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "album_sources_album_id_idx" ON "album_sources" USING btree ("album_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "album_sources_type_idx" ON "album_sources" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "album_submissions_status_idx" ON "album_submissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "album_submissions_created_at_idx" ON "album_submissions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "albums_event_id_idx" ON "albums" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "albums_status_idx" ON "albums" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "albums_provider_idx" ON "albums" USING btree ("provider");