ALTER TABLE "tools" ADD COLUMN "is_featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tools" ADD COLUMN "featured_note" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tools_is_featured_idx" ON "tools" USING btree ("is_featured");