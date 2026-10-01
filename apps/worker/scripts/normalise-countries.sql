-- Country backfill: every stored country as an ISO 3166-1 alpha-2 code.
--
-- Same mapping as packages/db/src/country.ts (normaliseCountry): a known
-- spelling becomes its code, any other two-letter value is upper-cased, and
-- anything else is left as it is. Blank becomes NULL on the two text columns.
-- grants.countries: each element mapped, duplicates dropped, order kept.
--
-- Not a drizzle migration. Run by hand, once:
--   psql "$DATABASE_URL" -f apps/worker/scripts/normalise-countries.sql
-- It prints the before/after counts and runs in one transaction; the
-- SELECTs at the end show what is left that is not a two-letter code.

BEGIN;

CREATE TEMP TABLE country_alias (alias text PRIMARY KEY, code text NOT NULL) ON COMMIT DROP;
INSERT INTO country_alias (alias, code) VALUES
    ('us', 'US'),
    ('usa', 'US'),
    ('u s', 'US'),
    ('u s a', 'US'),
    ('united states', 'US'),
    ('united states of america', 'US'),
    ('america', 'US'),
    ('ca', 'CA'),
    ('can', 'CA'),
    ('canada', 'CA'),
    ('mx', 'MX'),
    ('mex', 'MX'),
    ('mexico', 'MX'),
    ('méxico', 'MX'),
    ('au', 'AU'),
    ('aus', 'AU'),
    ('australia', 'AU'),
    ('tr', 'TR'),
    ('tur', 'TR'),
    ('turkey', 'TR'),
    ('türkiye', 'TR'),
    ('turkiye', 'TR'),
    ('cn', 'CN'),
    ('chn', 'CN'),
    ('china', 'CN'),
    ('people''s republic of china', 'CN'),
    ('tw', 'TW'),
    ('twn', 'TW'),
    ('taiwan', 'TW'),
    ('chinese taipei', 'TW'),
    ('il', 'IL'),
    ('isr', 'IL'),
    ('israel', 'IL'),
    ('gb', 'GB'),
    ('uk', 'GB'),
    ('gbr', 'GB'),
    ('united kingdom', 'GB'),
    ('great britain', 'GB'),
    ('england', 'GB'),
    ('scotland', 'GB'),
    ('wales', 'GB'),
    ('br', 'BR'),
    ('brazil', 'BR'),
    ('brasil', 'BR'),
    ('nz', 'NZ'),
    ('new zealand', 'NZ'),
    ('jp', 'JP'),
    ('japan', 'JP'),
    ('in', 'IN'),
    ('india', 'IN'),
    ('nl', 'NL'),
    ('netherlands', 'NL'),
    ('the netherlands', 'NL'),
    ('de', 'DE'),
    ('germany', 'DE'),
    ('fr', 'FR'),
    ('france', 'FR'),
    ('co', 'CO'),
    ('colombia', 'CO'),
    ('cl', 'CL'),
    ('chile', 'CL'),
    ('do', 'DO'),
    ('dominican republic', 'DO'),
    ('kr', 'KR'),
    ('south korea', 'KR'),
    ('korea', 'KR');

CREATE OR REPLACE FUNCTION pg_temp.normalise_country(value text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN value IS NULL OR btrim(value) = '' THEN NULL
    ELSE COALESCE(
      (SELECT code FROM country_alias
        WHERE alias = btrim(regexp_replace(lower(regexp_replace(btrim(value), '\.', ' ', 'g')), '\s+', ' ', 'g'))),
      CASE WHEN btrim(value) ~* '^[a-z]{2}$' THEN upper(btrim(value)) ELSE regexp_replace(btrim(value), '\s+', ' ', 'g') END
    )
  END
$$;

-- What will change.
SELECT 'event_listings' AS tbl, country AS before, pg_temp.normalise_country(country) AS after, count(*)
  FROM event_listings WHERE country IS DISTINCT FROM pg_temp.normalise_country(country) GROUP BY 1, 2, 3
UNION ALL
SELECT 'practice_fields', country, pg_temp.normalise_country(country), count(*)
  FROM practice_fields WHERE country IS DISTINCT FROM pg_temp.normalise_country(country) GROUP BY 1, 2, 3
ORDER BY 1, 4 DESC;

UPDATE event_listings
   SET country = pg_temp.normalise_country(country)
 WHERE country IS DISTINCT FROM pg_temp.normalise_country(country);

UPDATE practice_fields
   SET country = pg_temp.normalise_country(country)
 WHERE country IS DISTINCT FROM pg_temp.normalise_country(country);

-- grants.countries is NOT NULL with default '{US}'; an array that maps to
-- nothing keeps its old value rather than becoming empty.
WITH mapped AS (
  SELECT g.id,
         ARRAY(
           SELECT c FROM (
             SELECT pg_temp.normalise_country(e) AS c, min(ord) AS first_at
               FROM unnest(g.countries) WITH ORDINALITY AS u(e, ord)
              GROUP BY 1
           ) d
            WHERE c IS NOT NULL
            ORDER BY first_at
         ) AS countries
    FROM grants g
)
UPDATE grants g
   SET countries = m.countries
  FROM mapped m
 WHERE g.id = m.id
   AND cardinality(m.countries) > 0
   AND g.countries IS DISTINCT FROM m.countries;

-- Left over: values that are not a two-letter code. Look at these by hand.
SELECT 'event_listings' AS tbl, country, count(*) FROM event_listings WHERE country !~ '^[A-Z]{2}$' GROUP BY 1, 2
UNION ALL
SELECT 'practice_fields', country, count(*) FROM practice_fields WHERE country !~ '^[A-Z]{2}$' GROUP BY 1, 2
UNION ALL
SELECT 'grants', e, count(*) FROM grants, unnest(countries) e WHERE e !~ '^[A-Z]{2}$' GROUP BY 1, 2;

COMMIT;
