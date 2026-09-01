CREATE TABLE IF NOT EXISTS "notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"subject_type" text,
	"subject_id" uuid,
	"payload" jsonb,
	"dedupe_key" text NOT NULL,
	"send_after" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "submitted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "album_submissions" ADD COLUMN "submitted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "grant_candidates" ADD COLUMN "submitted_by_user_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notification_outbox_dedupe_idx" ON "notification_outbox" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_outbox_pending_idx" ON "notification_outbox" USING btree ("sent_at","send_after");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_outbox_user_idx" ON "notification_outbox" USING btree ("user_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submissions" ADD CONSTRAINT "submissions_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "album_submissions" ADD CONSTRAINT "album_submissions_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grant_candidates" ADD CONSTRAINT "grant_candidates_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "submissions_submitted_by_idx" ON "submissions" USING btree ("submitted_by_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "album_submissions_submitted_by_idx" ON "album_submissions" USING btree ("submitted_by_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_candidates_submitted_by_idx" ON "grant_candidates" USING btree ("submitted_by_user_id");