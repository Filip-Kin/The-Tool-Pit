ALTER TABLE "notification_outbox" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "practice_fields" ADD COLUMN "outreach_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "practice_fields" ADD COLUMN "outreach_sent_to" text;--> statement-breakpoint
ALTER TABLE "event_listings" ADD COLUMN "outreach_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_listings" ADD COLUMN "outreach_sent_to" text;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN "recipient_email" text;