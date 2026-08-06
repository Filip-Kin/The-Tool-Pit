CREATE TABLE IF NOT EXISTS "field_photos" (
	"field_id" uuid PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "practice_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_number" integer,
	"team_name" text,
	"program" text DEFAULT 'frc' NOT NULL,
	"name" text NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"address" text,
	"city" text,
	"region" text,
	"country" text,
	"coverage" text DEFAULT 'full' NOT NULL,
	"perimeter" text DEFAULT 'none' NOT NULL,
	"elements" text DEFAULT 'wood' NOT NULL,
	"has_fms" boolean DEFAULT false NOT NULL,
	"april_tags" boolean DEFAULT false NOT NULL,
	"ceiling_height_ft" real,
	"availability" text DEFAULT 'unknown' NOT NULL,
	"hours" text,
	"contact_info" text,
	"contact_url" text,
	"website" text,
	"notes" text,
	"photo_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"source" text DEFAULT 'submission' NOT NULL,
	"rejection_reason" text,
	"submitter_name" text,
	"submitter_contact" text,
	"submitter_ip_hash" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "field_photos" ADD CONSTRAINT "field_photos_field_id_practice_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."practice_fields"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "practice_fields_status_idx" ON "practice_fields" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "practice_fields_program_idx" ON "practice_fields" USING btree ("program");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "practice_fields_team_number_idx" ON "practice_fields" USING btree ("team_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "practice_fields_created_at_idx" ON "practice_fields" USING btree ("created_at");