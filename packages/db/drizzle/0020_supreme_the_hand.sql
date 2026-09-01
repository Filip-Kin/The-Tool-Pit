ALTER TABLE "users" ADD COLUMN "github_login" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "github_user_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "github_linked_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_github_user_id_idx" ON "users" USING btree ("github_user_id");