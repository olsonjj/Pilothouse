# 05: V/TO view & edit

**What to build:** The two-page Vision/Traction Organizer covering all eight questions, readable by everyone and editable by admins via structured forms (including the structured lists for the 3-Year Picture and 1-Year Plan). Single live version; versioning comes next.

**Blocked by:** 01: Scaffold, auth & test seam.

**Status:** done (ticket 06 carries versioning; ticket 07 core values)

- [x] All eight questions render as a readable two-page view for any signed-in user
- [x] Admin edit forms: core focus, 10-year target, marketing strategy (four sub-fields), 3-year picture (date/revenue/profit + list), 1-year plan (year/revenue/profit + items + priorities)
- [x] 3-Year Picture and 1-Year Plan are structured ordered lists, not textareas
- [x] Financial figures are plain numbers; list items are short strings
- [x] Members editing is rejected at the server-function seam

**Implementation notes:**
- Created a single live `vto` table (one row, id 1, upsert) instead of
  `vto_versions` — versioning is ticket 06. Column shape mirrors the planned
  `vto_versions` minus `published_at`/`created_by`, so the 06 migration is a
  copy-row operation. Questions 1 (core values) and 8 (issues) render as
  placeholders pointing at tickets 07 and 16.
- Date validation does a real calendar round-trip (month 13 rejected), unlike
  people.ts's shape-only regex — same hardening can be applied there later.
- List items: trimmed, non-empty, ≤200 chars; money: non-negative integers.
