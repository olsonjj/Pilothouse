# 06: V/TO versioning & restore

**What to build:** Safety net for the vision: every admin save of the V/TO creates a snapshot version; admins can view version history and restore any version (restore = new version, never destructive).

**Blocked by:** 05: V/TO view & edit.

**Status:** ready-for-agent

- [x] Each save produces a new version with author and timestamp; a "published as of" date shows on the read view
- [x] Version history is listable; any version restorable
- [x] Restore creates a new version (history is append-only)
- [x] No field-level diffs — whole-snapshot versions
- [x] Seam tests: edit → new version; restore → new version with old content

**Status:** complete (ticket 06). Deltas documented in data-model.md: live `vto`
row kept as-is (upsert-only, id 1); publishedAs-of = newest snapshot's
`published_at` (fallback: live row's `updated_at`); pre-existing live rows are
backfilled into the first version by an idempotent init step (author = first
user) instead of in-migration SQL, so it is testable at the seam. Notes for
later tickets: ticket 07 (core values) is untouched by this model; ticket 10
(People Analyzer) reads core values only — no V/TO coupling.
