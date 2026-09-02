/**
 * A tool's URL slug, built from its title. Zero imports, on purpose.
 *
 * There were two of these. The worker's pipeline had `buildSlug`, and the admin
 * publish button re-inlined the same four replaces and left off the last one,
 * the trim, so a title ending in punctuation produced a slug with a trailing
 * hyphen. A test pins the trim on the worker's copy, which is not the copy the
 * button used.
 *
 * NOT the same thing as apps/web/lib/utils/slugify.ts. That one collapses
 * underscores to hyphens and trims first, and it is used for grants. The two
 * live in different namespaces so they cannot collide, but they are not
 * interchangeable and neither should quietly become the other.
 *
 * Pure. Uniqueness is the caller's problem, because only the caller knows which
 * table it is writing to.
 */
export function buildSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
    // Last, and after the truncation: slicing to 80 can land on a hyphen.
    .replace(/^-+|-+$/g, '')
}
