CREATE TABLE IF NOT EXISTS "album_covers" (
	"album_id" uuid PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_code_year_uq";--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "program" text DEFAULT 'frc' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "source_key" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "album_covers" ADD CONSTRAINT "album_covers_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_program_code_year_uq" UNIQUE("program","event_code","year");