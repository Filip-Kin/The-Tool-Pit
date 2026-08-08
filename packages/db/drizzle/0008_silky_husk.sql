CREATE TABLE IF NOT EXISTS "field_edit_proposal_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- field_photos is moving from one-per-field (field_id as PK) to many-per-field
-- (a new surrogate id PK). Drop the existing single-column PK first, by lookup,
-- so existing photo rows are preserved regardless of the constraint's name.
DO $$
DECLARE pk_name text;
BEGIN
  SELECT constraint_name INTO pk_name
    FROM information_schema.table_constraints
   WHERE table_schema = 'public'
     AND table_name = 'field_photos'
     AND constraint_type = 'PRIMARY KEY';
  IF pk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "field_photos" DROP CONSTRAINT %I', pk_name);
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "field_edit_proposals" ADD COLUMN "remove_photo_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "field_photos" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "field_photos" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "field_photos" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "field_edit_proposal_photos" ADD CONSTRAINT "field_edit_proposal_photos_proposal_id_field_edit_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."field_edit_proposals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "field_edit_proposal_photos_proposal_id_idx" ON "field_edit_proposal_photos" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "field_photos_field_id_idx" ON "field_photos" USING btree ("field_id");--> statement-breakpoint
ALTER TABLE "field_photos" DROP COLUMN IF EXISTS "updated_at";--> statement-breakpoint
ALTER TABLE "practice_fields" DROP COLUMN IF EXISTS "photo_url";
