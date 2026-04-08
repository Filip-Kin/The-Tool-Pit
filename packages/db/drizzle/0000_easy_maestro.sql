CREATE TABLE IF NOT EXISTS "tool_audience_functions" (
	"tool_id" uuid NOT NULL,
	"function_id" integer NOT NULL,
	CONSTRAINT "tool_audience_functions_tool_id_function_id_pk" PRIMARY KEY("tool_id","function_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tool_audience_primary_roles" (
	"tool_id" uuid NOT NULL,
	"role_id" integer NOT NULL,
	CONSTRAINT "tool_audience_primary_roles_tool_id_role_id_pk" PRIMARY KEY("tool_id","role_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tool_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_id" uuid NOT NULL,
	"link_type" text NOT NULL,
	"url" text NOT NULL,
	"label" text,
	"is_broken" boolean DEFAULT false NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tool_programs" (
	"tool_id" uuid NOT NULL,
	"program_id" integer NOT NULL,
	CONSTRAINT "tool_programs_tool_id_program_id_pk" PRIMARY KEY("tool_id","program_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"summary" text,
	"description" text,
	"tool_type" text DEFAULT 'other' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"is_official" boolean DEFAULT false NOT NULL,
	"is_vendor" boolean DEFAULT false NOT NULL,
	"is_rookie_friendly" boolean DEFAULT false NOT NULL,
	"is_team_code" boolean DEFAULT false NOT NULL,
	"team_number" integer,
	"season_year" integer,
	"vendor_name" text,
	"confidence_score" real DEFAULT 0,
	"popularity_score" real DEFAULT 0 NOT NULL,
	"freshness_state" text DEFAULT 'unknown',
	"last_activity_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tools_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "programs" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	CONSTRAINT "programs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audience_functions" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "audience_functions_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audience_primary_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "audience_primary_roles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tool_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_url" text,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_metadata" jsonb,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tool_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_id" uuid NOT NULL,
	"signal_type" text NOT NULL,
	"signal_at" timestamp with time zone NOT NULL,
	"raw_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tool_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_id" uuid NOT NULL,
	"voter_fingerprint" text NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_votes_unique" UNIQUE("tool_id","voter_fingerprint")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "search_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query" text NOT NULL,
	"program_filter" text,
	"result_count" integer DEFAULT 0 NOT NULL,
	"session_id" text,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tool_click_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_id" uuid NOT NULL,
	"link_type" text NOT NULL,
	"session_id" text,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"submitter_note" text,
	"submitter_ip_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolved_tool_id" uuid,
	"pipeline_log" jsonb,
	"confidence_score" real,
	"spam_score" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crawl_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"source_url" text NOT NULL,
	"canonical_url" text,
	"raw_metadata" jsonb,
	"classification" jsonb,
	"confidence_score" real,
	"status" text DEFAULT 'pending' NOT NULL,
	"matched_tool_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crawl_jobs" (
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
DO $$ BEGIN
 ALTER TABLE "tool_audience_functions" ADD CONSTRAINT "taf_tool_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tool_audience_functions" ADD CONSTRAINT "taf_fn_fk" FOREIGN KEY ("function_id") REFERENCES "public"."audience_functions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tool_audience_primary_roles" ADD CONSTRAINT "tapr_tool_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tool_audience_primary_roles" ADD CONSTRAINT "tapr_role_fk" FOREIGN KEY ("role_id") REFERENCES "public"."audience_primary_roles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tool_links" ADD CONSTRAINT "tool_links_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tool_programs" ADD CONSTRAINT "tool_programs_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tool_programs" ADD CONSTRAINT "tool_programs_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tool_sources" ADD CONSTRAINT "tool_sources_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tool_updates" ADD CONSTRAINT "tool_updates_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tool_votes" ADD CONSTRAINT "tool_votes_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tool_click_events" ADD CONSTRAINT "tool_click_events_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submissions" ADD CONSTRAINT "submissions_resolved_tool_id_tools_id_fk" FOREIGN KEY ("resolved_tool_id") REFERENCES "public"."tools"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crawl_candidates" ADD CONSTRAINT "crawl_candidates_job_id_crawl_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."crawl_jobs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crawl_candidates" ADD CONSTRAINT "crawl_candidates_matched_tool_id_tools_id_fk" FOREIGN KEY ("matched_tool_id") REFERENCES "public"."tools"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_links_tool_id_idx" ON "tool_links" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_links_type_idx" ON "tool_links" USING btree ("link_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tools_search_idx" ON "tools" USING gin (to_tsvector('english', "name" || ' ' || coalesce("summary", '') || ' ' || coalesce("description", '')));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tools_name_trgm_idx" ON "tools" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tools_status_idx" ON "tools" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tools_popularity_idx" ON "tools" USING btree ("popularity_score");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tools_published_at_idx" ON "tools" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tools_is_team_code_idx" ON "tools" USING btree ("is_team_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tools_team_number_idx" ON "tools" USING btree ("team_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tools_season_year_idx" ON "tools" USING btree ("season_year");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_sources_tool_id_idx" ON "tool_sources" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_sources_type_idx" ON "tool_sources" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_updates_tool_id_idx" ON "tool_updates" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_updates_signal_at_idx" ON "tool_updates" USING btree ("signal_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_votes_tool_id_idx" ON "tool_votes" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_votes_voter_idx" ON "tool_votes" USING btree ("voter_fingerprint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_events_created_at_idx" ON "search_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_events_query_idx" ON "search_events" USING btree ("query");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_click_events_tool_id_idx" ON "tool_click_events" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_click_events_created_at_idx" ON "tool_click_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "submissions_status_idx" ON "submissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "submissions_created_at_idx" ON "submissions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crawl_candidates_job_id_idx" ON "crawl_candidates" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crawl_candidates_status_idx" ON "crawl_candidates" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crawl_candidates_canonical_url_idx" ON "crawl_candidates" USING btree ("canonical_url");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crawl_jobs_connector_idx" ON "crawl_jobs" USING btree ("connector");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crawl_jobs_status_idx" ON "crawl_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crawl_jobs_created_at_idx" ON "crawl_jobs" USING btree ("created_at");