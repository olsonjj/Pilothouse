# 09: GWC ratings

**What to build:** Right People, Right Seat data: per person-per-seat (per assignment) Get it / Want it / Capacity booleans plus a free-text note, admin-editable and shown on seat and person detail.

**Blocked by:** 04: Seats & assignments.

**Status:** ready-for-agent

- [x] Admin records GWC per active assignment with an optional note
- [x] Ratings belong to the person-in-seat; ending an assignment keeps its history
- [x] Seat and person detail pages display GWC
- [x] Admins edit; every signed-in user views (delta from the original "only admins view and edit": the decided access rules in data-model.md say "everyone views everything except other people's People Analyzer scores", and the spec lists GWC on the everyone-readable seat detail — so GWC view = all, edit = admin)
- [x] Seam tests cover set/update and history retention

**Status:** done. Deltas: GWC columns are seam-validated (no DB CHECK — ALTER TABLE ADD COLUMN CHECKs would desync drizzle-kit snapshots); note capped at 1000 chars at the seam; setGwc is a full overwrite (nulls clear). GWC edit surface: seat detail (per active occupant); person view (people page, "Seats & GWC") is read-only. Notes for ticket 10: GWC summary column can read from assignment history rows (active assignment's stored ratings); view-with-history requires no new joins beyond aliased gwc_* columns.
