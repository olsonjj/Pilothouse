# Rocks

## Purpose (EOS context)

Rocks are the 3–7 most important things a team must get done in the next 90 days,
plus each individual's personal rocks (usually 3–7 per person, 7 max). Rocks make
the 1-Year Plan concrete. They are set at the quarterly meeting, reviewed weekly in
the Level 10, and scored at quarter end: **on/off-track** during the quarter,
complete/incomplete at its end. A rock is binary — done or not done.

## What it is

A quarter-scoped rock list with owners, weekly status updates, and completion
scoring.

### Rocks

- Rock statement: an objective phrased as "verb + what + done by" — one sentence,
  free text. No subtasks, no descriptions longer than a few sentences (optional
  detail field).
- Fields: quarter, owner (person/seat), team (initially always the single team),
  status, optional measurable, optional detail.
- **Binary vs measurable rocks** (per *Traction*): most rocks are binary — done or
  not done. A rock may optionally carry a target number (e.g., "grow sales from
  $10M to $15M"); such rocks are reported weekly as an actual vs. target using
  the "measuring" status. A `measuring` status is only valid when a target exists.
- **Company vs individual rocks:** in EOS there are company rocks and per-seat
  rocks. Model both as rocks with a flag (`company: bool`) or an owner of null
  (company). Company rocks are set by admins; personal rocks are set by the owner
  of the rock (with admin visibility).
- Cap enforcement is a nudge, not a hard rule: warn above 7 per team / 7 per person.

### Weekly status

- Once a week (at/before the L10), the owner sets the rock status using the
  official EOS traffic lights: **on-track** (green), **off-track** (red), or
  **measuring** (blue — target-based rocks; entering the week's actual number
  accompanies this status).
- Status history is kept (week + status + optional one-line comment) so trends are
  visible — this mirrors the Scorecard's weekly cadence and reuses the same week
  concept.
- A rock that is off-track two or more weeks is highlighted (EOS norm: it goes to
  the Issues List — we make that a one-click "add to issues" action once the Issues
  module exists; until then it is a visual highlight).

### Quarter lifecycle

- At quarter start: rocks are created/set (or carried over from last quarter — a
  rock not completed can be re-set as a new rock for the new quarter, explicitly
  marked as carried over; we never silently extend).
- At quarter end: each rock is marked **complete / incomplete**, producing a
  completion percentage per person and per team (EOS norms: ~80% is strong).
- Completed/closed quarters become read-only history; dashboards can show the last
  N quarters' completion rates.

## What it is not

- **Not a task manager.** No subtasks, checklists, due-date pickers within the
  quarter, Kanban boards, or assignments to multiple people. A rock has one owner.
- **Not connected to To-Dos.** A to-do ("call the printer vendor") is not a rock
  ("switch to new print vendor by Mar 15"). Separate modules, separate lists.
- **No time tracking, no effort estimates, no Gantt/timeline views.**
- **No automatic cascading** from the 1-Year Plan: admins manually derive rocks
  from it.

## Data concepts

- `quarters`: id, label ("2025 Q1"), start/end dates.
- `rocks`: id, quarter_id, owner_person_id (nullable for company rocks), team_id,
  statement, detail, is_company, target (nullable, with direction like scorecard
  metrics for lower-is-better targets), created_by, carried_over_from_rock_id
  (nullable).
- `rock_statuses`: rock_id, week (date of week start), status enum
  (on_track/off_track/measuring), actual (nullable, set when status is
  measuring), comment.

## v1 vs later

- **v1:** quarter selection, create/edit rocks, weekly status updates, quarter-end
  scoring + completion %, carry-over.
- **Later:** multi-team rock lists, sparkline/trend display, "my rocks" widget on
  a dashboard.

## Decided

1. **Status cadence:** strict once-per-week overwrite per rock — one status row
   per rock per week, re-entering replaces the week's status. Keeps trends calm
   and the schema simple.

---

*Historical open question (decided above):* weekly overwrite vs. appended
mid-week updates.