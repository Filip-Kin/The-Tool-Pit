ALTER TABLE "tool_votes" ADD COLUMN "user_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tool_votes" ADD CONSTRAINT "tool_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tool_votes_user_unique" ON "tool_votes" USING btree ("tool_id","user_id") WHERE user_id is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_votes_user_idx" ON "tool_votes" USING btree ("user_id");