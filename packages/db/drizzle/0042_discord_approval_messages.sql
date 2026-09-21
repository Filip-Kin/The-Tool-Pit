CREATE TABLE IF NOT EXISTS "discord_approval_messages" (
	"message_id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"vertical" text NOT NULL,
	"entity_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_via" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "discord_approval_messages_entity_idx" ON "discord_approval_messages" USING btree ("vertical","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discord_approval_messages_status_idx" ON "discord_approval_messages" USING btree ("status");