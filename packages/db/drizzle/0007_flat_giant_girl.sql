CREATE TABLE IF NOT EXISTS "field_edit_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"field_id" uuid NOT NULL,
	"proposed" jsonb NOT NULL,
	"note" text,
	"submitter_name" text,
	"submitter_contact" text,
	"submitter_ip_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "field_edit_proposals" ADD CONSTRAINT "field_edit_proposals_field_id_practice_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."practice_fields"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "field_edit_proposals_field_id_idx" ON "field_edit_proposals" USING btree ("field_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "field_edit_proposals_status_idx" ON "field_edit_proposals" USING btree ("status");