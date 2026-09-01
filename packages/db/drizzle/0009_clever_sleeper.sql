CREATE TABLE IF NOT EXISTS "favorites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"address" text NOT NULL,
	"push_keys" jsonb,
	"verified" boolean DEFAULT false NOT NULL,
	"verify_token_hash" text,
	"verify_expires_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"program" text DEFAULT 'frc' NOT NULL,
	"team_number" integer NOT NULL,
	"role" text DEFAULT 'student' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firebase_uid" text NOT NULL,
	"email" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"display_name" text,
	"photo_url" text,
	"is_admin" boolean DEFAULT false NOT NULL,
	"blocked_reason" text,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grant_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grant_id" uuid NOT NULL,
	"cycle_year" integer NOT NULL,
	"opens_at" date,
	"deadline_at" timestamp with time zone,
	"deadline_note" text,
	"decision_at" date,
	"status" text DEFAULT 'unknown' NOT NULL,
	"amount_note" text,
	"source_url" text,
	"verified_at" timestamp with time zone,
	"verified_by" text,
	"is_estimated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grant_form_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grant_id" uuid NOT NULL,
	"fill_kind" text DEFAULT 'copy' NOT NULL,
	"param_name" text,
	"profile_path" text NOT NULL,
	"label" text,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grant_funders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'other' NOT NULL,
	"website" text,
	"logo_url" text,
	"notes" text,
	"sponsor_mention_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grant_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"operator" text DEFAULT 'is' NOT NULL,
	"value" jsonb,
	"label" text NOT NULL,
	"is_blocking" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"funder_id" uuid,
	"summary" text,
	"description" text,
	"info_url" text NOT NULL,
	"application_url" text,
	"programs" text[] DEFAULT '{"any"}' NOT NULL,
	"geo_scope" text DEFAULT 'national' NOT NULL,
	"countries" text[] DEFAULT '{"US"}' NOT NULL,
	"regions" text[] DEFAULT '{}' NOT NULL,
	"locality_note" text,
	"award_min" integer,
	"award_max" integer,
	"award_currency" text DEFAULT 'USD' NOT NULL,
	"award_notes" text,
	"renewable" boolean,
	"deadline_type" text DEFAULT 'unknown' NOT NULL,
	"effort_level" text DEFAULT 'unknown' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"source" text DEFAULT 'seed' NOT NULL,
	"rejection_reason" text,
	"verified_at" timestamp with time zone,
	"verified_by" text,
	"last_checked_at" timestamp with time zone,
	"content_hash" text,
	"check_cadence_hours" integer DEFAULT 168 NOT NULL,
	"check_failure_count" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grant_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"source_id" uuid,
	"source_url" text NOT NULL,
	"canonical_url" text,
	"raw_metadata" jsonb,
	"classification" jsonb,
	"confidence_score" real,
	"status" text DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"matched_grant_id" uuid,
	"submitter_name" text,
	"submitter_contact" text,
	"submitter_ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grant_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grant_id" uuid NOT NULL,
	"snapshot_id" uuid,
	"field" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"reasoning" text,
	"auto_applicable" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grant_crawl_jobs" (
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
CREATE TABLE IF NOT EXISTS "grant_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grant_id" uuid,
	"url" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"http_status" integer,
	"content_hash" text,
	"content_text" text,
	"extracted" jsonb,
	"changed" boolean DEFAULT false NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grant_sources" (
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
CREATE TABLE IF NOT EXISTS "grant_sponsor_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funder_key" text NOT NULL,
	"raw_name" text NOT NULL,
	"program" text DEFAULT 'frc' NOT NULL,
	"team_number" integer,
	"source_url" text NOT NULL,
	"funder_url" text,
	"resolved_funder_id" uuid,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grant_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"grant_id" uuid,
	"cycle_id" uuid,
	"payload" jsonb,
	"dedupe_key" text NOT NULL,
	"send_after" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grant_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"cycle_id" uuid,
	"status" text DEFAULT 'interested' NOT NULL,
	"amount_requested" integer,
	"amount_awarded" integer,
	"notes" text,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grant_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"cycle_id" uuid,
	"verdict" text NOT NULL,
	"score" real DEFAULT 0 NOT NULL,
	"reasons" jsonb,
	"missing_fields" text[] DEFAULT '{}' NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grant_watches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"remind_days_before" integer[] DEFAULT '{30,14,3}' NOT NULL,
	"notify_on_change" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_profile_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'editor' NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program" text DEFAULT 'frc' NOT NULL,
	"team_number" integer NOT NULL,
	"team_name" text,
	"org_type" text DEFAULT 'unknown' NOT NULL,
	"ein" text,
	"fiscal_sponsor_name" text,
	"school_type" text DEFAULT 'unknown' NOT NULL,
	"school_name" text,
	"title_one" boolean,
	"country" text DEFAULT 'US' NOT NULL,
	"region" text,
	"city" text,
	"postal_code" text,
	"mailing_address" text,
	"rookie_year" integer,
	"student_count" integer,
	"mentor_count" integer,
	"annual_budget" integer,
	"demographics" jsonb,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"website" text,
	"mission_statement" text,
	"boilerplate" jsonb,
	"completeness" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_teams" ADD CONSTRAINT "user_teams_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grant_cycles" ADD CONSTRAINT "grant_cycles_grant_id_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."grants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grant_form_fields" ADD CONSTRAINT "grant_form_fields_grant_id_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."grants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grant_requirements" ADD CONSTRAINT "grant_requirements_grant_id_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."grants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grants" ADD CONSTRAINT "grants_funder_id_grant_funders_id_fk" FOREIGN KEY ("funder_id") REFERENCES "public"."grant_funders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grant_candidates" ADD CONSTRAINT "grant_candidates_job_id_grant_crawl_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."grant_crawl_jobs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grant_candidates" ADD CONSTRAINT "grant_candidates_source_id_grant_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."grant_sources"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grant_candidates" ADD CONSTRAINT "grant_candidates_matched_grant_id_grants_id_fk" FOREIGN KEY ("matched_grant_id") REFERENCES "public"."grants"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grant_changes" ADD CONSTRAINT "grant_changes_grant_id_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."grants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grant_changes" ADD CONSTRAINT "grant_changes_snapshot_id_grant_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."grant_snapshots"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grant_crawl_jobs" ADD CONSTRAINT "grant_crawl_jobs_source_id_grant_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."grant_sources"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grant_snapshots" ADD CONSTRAINT "grant_snapshots_grant_id_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."grants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grant_alerts" ADD CONSTRAINT "grant_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grant_alerts" ADD CONSTRAINT "grant_alerts_grant_id_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."grants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grant_alerts" ADD CONSTRAINT "grant_alerts_cycle_id_grant_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."grant_cycles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grant_applications" ADD CONSTRAINT "grant_applications_profile_id_team_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."team_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grant_applications" ADD CONSTRAINT "grant_applications_grant_id_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."grants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grant_applications" ADD CONSTRAINT "grant_applications_cycle_id_grant_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."grant_cycles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grant_matches" ADD CONSTRAINT "grant_matches_profile_id_team_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."team_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grant_matches" ADD CONSTRAINT "grant_matches_grant_id_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."grants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grant_matches" ADD CONSTRAINT "grant_matches_cycle_id_grant_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."grant_cycles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grant_watches" ADD CONSTRAINT "grant_watches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grant_watches" ADD CONSTRAINT "grant_watches_grant_id_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."grants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_profile_members" ADD CONSTRAINT "team_profile_members_profile_id_team_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."team_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_profile_members" ADD CONSTRAINT "team_profile_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "favorites_user_entity_idx" ON "favorites" USING btree ("user_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "favorites_user_type_idx" ON "favorites" USING btree ("user_id","entity_type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notification_channels_user_address_idx" ON "notification_channels" USING btree ("user_id","kind","address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_channels_user_idx" ON "notification_channels" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_teams_user_team_idx" ON "user_teams" USING btree ("user_id","program","team_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_teams_team_idx" ON "user_teams" USING btree ("program","team_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_firebase_uid_idx" ON "users" USING btree ("firebase_uid");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "grant_cycles_grant_year_idx" ON "grant_cycles" USING btree ("grant_id","cycle_year");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_cycles_deadline_idx" ON "grant_cycles" USING btree ("deadline_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_cycles_status_idx" ON "grant_cycles" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_form_fields_grant_idx" ON "grant_form_fields" USING btree ("grant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "grant_funders_slug_idx" ON "grant_funders" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_funders_name_idx" ON "grant_funders" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_requirements_grant_idx" ON "grant_requirements" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_requirements_kind_idx" ON "grant_requirements" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "grants_slug_idx" ON "grants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grants_status_idx" ON "grants" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grants_funder_idx" ON "grants" USING btree ("funder_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grants_geo_scope_idx" ON "grants" USING btree ("geo_scope");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grants_last_checked_idx" ON "grants" USING btree ("last_checked_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_candidates_job_idx" ON "grant_candidates" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_candidates_status_idx" ON "grant_candidates" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_candidates_canonical_url_idx" ON "grant_candidates" USING btree ("canonical_url");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_changes_grant_idx" ON "grant_changes" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_changes_status_idx" ON "grant_changes" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_crawl_jobs_connector_idx" ON "grant_crawl_jobs" USING btree ("connector");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_crawl_jobs_status_idx" ON "grant_crawl_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_crawl_jobs_created_at_idx" ON "grant_crawl_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_snapshots_grant_idx" ON "grant_snapshots" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_snapshots_url_idx" ON "grant_snapshots" USING btree ("url");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_snapshots_fetched_at_idx" ON "grant_snapshots" USING btree ("fetched_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_sources_kind_idx" ON "grant_sources" USING btree ("kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_sources_enabled_idx" ON "grant_sources" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "grant_sponsor_mentions_key_team_idx" ON "grant_sponsor_mentions" USING btree ("funder_key","program","team_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_sponsor_mentions_key_idx" ON "grant_sponsor_mentions" USING btree ("funder_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "grant_alerts_dedupe_idx" ON "grant_alerts" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_alerts_pending_idx" ON "grant_alerts" USING btree ("sent_at","send_after");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_alerts_user_idx" ON "grant_alerts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "grant_applications_profile_grant_cycle_idx" ON "grant_applications" USING btree ("profile_id","grant_id","cycle_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_applications_status_idx" ON "grant_applications" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "grant_matches_profile_grant_cycle_idx" ON "grant_matches" USING btree ("profile_id","grant_id","cycle_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_matches_profile_verdict_idx" ON "grant_matches" USING btree ("profile_id","verdict");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_matches_notified_idx" ON "grant_matches" USING btree ("notified_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "grant_watches_user_grant_idx" ON "grant_watches" USING btree ("user_id","grant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_watches_grant_idx" ON "grant_watches" USING btree ("grant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "team_profile_members_profile_user_idx" ON "team_profile_members" USING btree ("profile_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_profile_members_user_idx" ON "team_profile_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "team_profiles_program_team_idx" ON "team_profiles" USING btree ("program","team_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_profiles_region_idx" ON "team_profiles" USING btree ("country","region");