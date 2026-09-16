CREATE TABLE IF NOT EXISTS "event_tba_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_listing_id" uuid NOT NULL,
	"auth_id" text NOT NULL,
	"auth_secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_tba_credentials_event_listing_id_unique" UNIQUE("event_listing_id")
);
--> statement-breakpoint
ALTER TABLE "event_listings" ADD COLUMN "tba_auto_push" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "event_listings" ADD COLUMN "tba_pushed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_listings" ADD COLUMN "tba_pushed_hash" text;--> statement-breakpoint
ALTER TABLE "event_listings" ADD COLUMN "tba_pushed_hash_day2" text;--> statement-breakpoint
ALTER TABLE "event_listings" ADD COLUMN "tba_push_status" text;--> statement-breakpoint
ALTER TABLE "event_listings" ADD COLUMN "tba_push_error" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_tba_credentials" ADD CONSTRAINT "event_tba_credentials_event_listing_id_event_listings_id_fk" FOREIGN KEY ("event_listing_id") REFERENCES "public"."event_listings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_tba_credentials_event_listing_id_idx" ON "event_tba_credentials" USING btree ("event_listing_id");