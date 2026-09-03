-- Adds the human URL slug to event_listings and practice_fields, the same key
-- tools and grants already use. The generated diff added `slug text NOT NULL`
-- in one step, which fails on a table that already holds rows, so the column is
-- added nullable, BACKFILLED from each row's name (team number + name for a
-- field), then made NOT NULL. The unique indexes come last, after every row
-- carries a distinct slug.
--
-- The slug mirrors apps/web/lib/utils/slugify.ts: lowercase, drop anything but
-- word characters / whitespace / hyphen, collapse runs to a single hyphen, trim
-- the ends, cap at 80. Uniqueness is a row_number() over the computed base, so
-- two rows that slugify the same get -1, -2 ... exactly like uniqueEventSlug.

ALTER TABLE "practice_fields" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "event_listings" ADD COLUMN "slug" text;--> statement-breakpoint

WITH base AS (
  SELECT
    id,
    created_at,
    NULLIF(
      regexp_replace(
        left(
          regexp_replace(
            regexp_replace(
              regexp_replace(lower(name), '[^a-z0-9_[:space:]-]', '', 'g'),
              '[[:space:]_-]+', '-', 'g'
            ),
            '^-+|-+$', '', 'g'
          ),
          80
        ),
        '-+$', '', 'g'
      ),
      ''
    ) AS root
  FROM "event_listings"
),
numbered AS (
  SELECT
    id,
    COALESCE(root, 'event') AS root,
    row_number() OVER (PARTITION BY COALESCE(root, 'event') ORDER BY created_at, id) AS rn
  FROM base
)
UPDATE "event_listings" e
SET slug = CASE WHEN n.rn = 1 THEN n.root ELSE n.root || '-' || (n.rn - 1) END
FROM numbered n
WHERE e.id = n.id;--> statement-breakpoint

WITH base AS (
  SELECT
    id,
    created_at,
    NULLIF(
      regexp_replace(
        left(
          regexp_replace(
            regexp_replace(
              regexp_replace(lower(concat_ws(' ', team_number::text, name)), '[^a-z0-9_[:space:]-]', '', 'g'),
              '[[:space:]_-]+', '-', 'g'
            ),
            '^-+|-+$', '', 'g'
          ),
          80
        ),
        '-+$', '', 'g'
      ),
      ''
    ) AS root
  FROM "practice_fields"
),
numbered AS (
  SELECT
    id,
    COALESCE(root, 'field') AS root,
    row_number() OVER (PARTITION BY COALESCE(root, 'field') ORDER BY created_at, id) AS rn
  FROM base
)
UPDATE "practice_fields" e
SET slug = CASE WHEN n.rn = 1 THEN n.root ELSE n.root || '-' || (n.rn - 1) END
FROM numbered n
WHERE e.id = n.id;--> statement-breakpoint

ALTER TABLE "practice_fields" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "event_listings" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "practice_fields_slug_idx" ON "practice_fields" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "event_listings_slug_idx" ON "event_listings" USING btree ("slug");
