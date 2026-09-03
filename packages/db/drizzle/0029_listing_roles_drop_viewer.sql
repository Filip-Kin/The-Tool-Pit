-- Drop the 'viewer' listing role. Everything on a listing is public, so a
-- read-only role granted nothing nobody else had. The two roles are now
-- 'owner' and 'editor'. Any row that still reads 'viewer' becomes 'editor',
-- the safe floor: an editor can do everything a viewer could and nothing that
-- only an owner may. The role columns are plain text with no check constraint,
-- so this is a data migration with no DDL.

UPDATE "listing_owners" SET "role" = 'editor' WHERE "role" = 'viewer';
UPDATE "listing_invites" SET "role" = 'editor' WHERE "role" = 'viewer';
