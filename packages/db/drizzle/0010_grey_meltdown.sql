ALTER TABLE "field_edit_proposals" ADD COLUMN "submitted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "practice_fields" ADD COLUMN "submitted_by_user_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "field_edit_proposals" ADD CONSTRAINT "field_edit_proposals_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "practice_fields" ADD CONSTRAINT "practice_fields_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
