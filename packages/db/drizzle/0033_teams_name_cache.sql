CREATE TABLE IF NOT EXISTS "teams" (
	"number" integer PRIMARY KEY NOT NULL,
	"nickname" text,
	"name" text,
	"city" text,
	"state_prov" text,
	"country" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
