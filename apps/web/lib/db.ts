/**
 * Re-export DB client for use within the web app.
 * Import this instead of @the-tool-pit/db directly so there's one place
 * to swap the client strategy if needed.
 */
export { getDb } from '@the-tool-pit/db'
