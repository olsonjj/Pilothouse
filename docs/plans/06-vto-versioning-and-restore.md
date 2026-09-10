# 06: V/TO versioning & restore

**What to build:** Safety net for the vision: every admin save of the V/TO creates a snapshot version; admins can view version history and restore any version (restore = new version, never destructive).

**Blocked by:** 05: V/TO view & edit.

**Status:** ready-for-agent

- [ ] Each save produces a new version with author and timestamp; a "published as of" date shows on the read view
- [ ] Version history is listable; any version restorable
- [ ] Restore creates a new version (history is append-only)
- [ ] No field-level diffs — whole-snapshot versions
- [ ] Seam tests: edit → new version; restore → new version with old content
