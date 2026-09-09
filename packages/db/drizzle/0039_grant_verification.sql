ALTER TABLE "grants" ADD COLUMN "apply_route_status" text;--> statement-breakpoint
ALTER TABLE "grants" ADD COLUMN "apply_route_evidence" text;--> statement-breakpoint
ALTER TABLE "grants" ADD COLUMN "apply_route_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "grants" ADD COLUMN "deadline_proof" text;--> statement-breakpoint
ALTER TABLE "grants" ADD COLUMN "deadline_proof_url" text;--> statement-breakpoint
ALTER TABLE "grants" ADD COLUMN "deadline_proof_checked_at" timestamp with time zone;