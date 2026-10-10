ALTER TABLE "grants" ADD COLUMN "invitation_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "grants" ADD COLUMN "invitation_proof" text;--> statement-breakpoint
ALTER TABLE "grants" ADD COLUMN "invitation_proof_url" text;