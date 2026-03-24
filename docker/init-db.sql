-- Enable required PostgreSQL extensions.
-- This file runs once on first container startup.
-- Schema migrations are handled by Drizzle separately.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- required for trigram search indexes
