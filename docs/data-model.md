# Data Model

Conventions apply to all tables; per-module tables follow. This reflects every
decision in `overview.md` and the specs — no open questions remain.

## Conventions

- **SQLite.** Server-side only, accessed through server functions + ORM
  (Drizzle). Schema stays ORM-portable so a later cloud-DB swap is
  contained (see overview stack note). Driver: Node's built-in
  `node:sqlite` via Drizzle's sqlite-proxy adapter (no native deps).
- **IDs:** `INTEGER PRIMARY KEY` (autoincrement).
- **Timestamps:** `TEXT` ISO-8601 UTC.
- **Base fields (every table):** `id INTEGER PRIMARY KEY`, `created_at TEXT`.
  Mutable tables also get `updated_at TEXT`. Implemented as a shared schema
  helper (spread into each Drizzle table definition), **not** a polymorphic
  base table. Immutable tables skip `updated_at`: `vto_versions` (snapshots —
  restoring creates a new row), `issue_resolutions` (resolution notes are
  write-once), `sessions`, `quarters` (seeded once, never mutated). Everything
  else mutates and carries `updated_at`,
  maintained by the ORM/app on every write.
- **Dates:** `TEXT` `YYYY-MM-DD` (dates only where time-of-day is meaningless —
  weeks, due dates, quarter boundaries).
- **Booleans:** `INTEGER` 0/1.
- **Enums:** `TEXT` + `CHECK` constraints (SQLite has no native enums).
- **Weeks:** never a separate table. A week is identified by the `TEXT` date of
  its Monday, derived by one shared `weekStart(date)` helper used by rock
  statuses, scorecard entries, and to-do due dates ("Week of Mar 3" display
  derives from it).
- **No cascading deletes** on historical data. Deleting is limited to open
  meetings and true mistakes; archives are immutable.
- **Join constraint (driver):** `node:sqlite` object rows collapse duplicate
  output column names, so every join select must SQL-alias columns uniquely
  (pattern in `listPeople`); documented in the driver adapter comment.

## Core / shared tables

### users
| column | type | notes |
| --- | --- | --- |
| id | int pk | |
| email | text unique | login identity |
| password_hash | text | email+password auth (overview) |
| name | text | denormalized fallback display name; once `person_id` is set, `people.full_name` is the source of truth (ticket 02) |
| role | text CHECK('admin','member') | app role, separate from seats |
| person_id | int FK→people, nullable | usually 1:1; nullable until linked |
| created_at / updated_at | text | |

Sessions: `sessions` (id = random token, user_id FK, expires_at). Standard.

### people
| column | type | notes |
| --- | --- | --- |
| id | int pk | |
| full_name | text | source of truth for a person's display name |
| email | text nullable | partial UNIQUE where not null |
| start_date | text nullable | date (YYYY-MM-DD) |
| created_at / updated_at | text | |

**Delta from spec (ticket 02):** the login link lives only on `users.person_id`
(one direction). The earlier `people.user_id` column was dropped as redundant —
a person's login is derivable by joining `users` on `person_id`.

### seats
| column | type | notes |
| --- | --- | --- |
| id | int pk | |
| name | text | "Visionary", "Integrator", … |
| description | text | |
| responsibilities | text (JSON array) | ordered short strings |
| parent_seat_id | int FK→seats, nullable | null = top seat |
| sort_order | int | among siblings |
| created_at / updated_at | text | |

### seat_assignments
| column | type | notes |
| --- | --- | --- |
| id | int pk | |
| person_id | int FK→people | |
| seat_id | int FK→seats | |
| started_at | text (date) | |
| ended_at | text nullable | NULL = current |
| gwc_get / gwc_want / gwc_capacity | int 0/1 | per assignment (spec) |
| gwc_note | text | |

- Current assignment = `ended_at IS NULL`.
- **App-enforced caps** (SQLite can't express either as an index):
  at most 2 active assignments per person (decided), and a seat has at most one
  active occupant at a time.

### teams
`id, name`. One row in v1 ("Company"). Team-scoping exists in the schema per the
overview assumption; no team-management UI.

### quarters
| column | type | notes |
| --- | --- | --- |
| id | int pk | |
| label | text unique | "2025 Q1" |
| start_date / end_date | text (date) | calendar-aligned (overview) |

Seeded for the current + next calendar years. Rocks, meeting archives, and
People Analyzer scores are quarter-scoped; scorecard weeks and to-dos are not.
**Delta (ticket 03):** quarters are seed-only and immutable — they skip
`updated_at` (added to the immutable list above).

## V/TO tables

### core_values
`id, name, description, sort_order, active(0/1)`.
First-class rows (stable IDs) — the People Analyzer scores against them, so they
live outside version snapshots. Only admins edit; changing the list is expected
to happen rarely.

### vto_versions
One row per save (snapshot model, spec: "editing creates a new version").
Scalar columns for: core focus ("why" + "what"), 10-year target (+ optional
date), marketing strategy (target market, proven process, guarantee — text),
3-year picture (date, revenue, profit — integers, whole dollars), 1-year plan
(label/year, revenue, profit). JSON-text columns for list-shaped fields:
`three_uniques`, `three_year_items`, `one_year_items`, `one_year_priorities`.
Plus `published_at`, `created_by`, `created_at`. Current = newest by
`published_at`/`id`. Restore = copy row into a new version. No field-level diffs.
Status (ticket 06): implemented. The live `vto` row still exists (id 1,
upsert-only); every save writes it AND appends a `vto_versions` snapshot. The
V/TO read view shows "published as of" = newest snapshot's `published_at`. An
idempotent init-time backfill copies a pre-existing live row into the first
version if no version exists yet.

## Rocks tables

### rocks
| column | type | notes |
| --- | --- | --- |
| id | int pk | |
| quarter_id | int FK→quarters | |
| team_id | int FK→teams | |
| owner_person_id | int FK→people, nullable | NULL = company rock |
| statement | text | verb + what + done-by |
| detail | text nullable | few sentences max |
| target | real nullable | measuring rocks only |
| target_direction | text CHECK('gte','lte') | default 'gte' |
| carried_over_from_rock_id | int FK→rocks, nullable | explicit carry-over |
| completed | int 0/1 nullable | set at quarter end |
| completed_at | text nullable | |
| created_by / created_at | | |

App-enforced cap nudge: warn above 7 per team (company rocks) and 7 per person.

### rock_statuses
| column | type | notes |
| --- | --- | --- |
| id | int pk | |
| rock_id | int FK→rocks | |
| week | text (date, a Monday) | |
| status | text CHECK('on_track','off_track','measuring') | |
| actual | real nullable | set when status='measuring' |
| comment | text nullable | one line |
| updated_by / updated_at | | |

`UNIQUE(rock_id, week)` — weekly overwrite (decided). App-enforced:
`measuring` requires a non-null rock target; the 2-consecutive-off-track
highlight is a query, not stored state.

## Scorecard tables

### metrics
`id, team_id, name, owner_person_id, target(real), direction CHECK('gte','lte'),
unit(text), active(0/1), created_at, updated_at`.
Definitions are not quarter-scoped (active flag + entry-time targets handle
retirement and re-targeting; targets change at quarter boundaries by convention).

### metric_entries
`id, metric_id FK, week (date, a Monday), value(real), target_at_entry(real),
entered_by, entered_at`. `UNIQUE(metric_id, week)` — weekly overwrite.
`target_at_entry` renders history correctly after re-targets.

## Issues tables

### issues
| column | type | notes |
| --- | --- | --- |
| id | int pk | |
| team_id | int FK→teams | |
| title | text | one line |
| classification | text CHECK('long_term','short_term') | |
| quarter_id | int FK→quarters | added-in context |
| origin | text CHECK('manual','from_rock','from_scorecard','from_todo','from_meeting') | |
| origin_source_id | int nullable | id of the rock/metric-entry/todo/meeting it came from |
| added_by / added_at | | |
| sort_order | int | manual ordering |

Status is derived: open until an `issue_resolutions` row exists.

### issue_resolutions
`id, issue_id FK, meeting_id FK→meetings nullable, outcome CHECK('solved','dropped'),
note, resolved_by, resolved_at`. Carry-forward is explicit: an unresolved
long-term issue at quarter end prompts carry-or-drop (UI behavior; carried items
re-attach to the new quarter as new rows or keep the row and re-point
`quarter_id` — implementation detail, decide at build: lean keep-row + update
`quarter_id`).

## To-Dos tables

### todos
| column | type | notes |
| --- | --- | --- |
| id | int pk | |
| team_id | int FK→teams | |
| title | text | one line only |
| assignee_person_id | int FK→people | exactly one |
| created_by | int FK→people | |
| source_meeting_id | int FK→meetings, nullable | |
| issue_source_id | int FK→issues, nullable | solving an issue creates to-dos |
| created_at | text | |
| due_date | text (date) | created_at + 7 days (decided) |
| status | text CHECK('open','done','dropped') | |
| completed_at | text nullable | |
| drop_reason | text nullable | required when dropped |

Completion rates derive from this table — no rollup tables (spec).

## Level 10 Meeting tables

### meetings
`id, team_id, date, status CHECK('open','concluded'), facilitator_person_id,
started_at, concluded_at, created_by, created_at`.
Advisory facilitator (decided). Open meetings are deletable (decided); concluded
meetings are frozen.

### meeting_segments
`id, meeting_id FK, segment_key CHECK IN ('segue','scorecard','rocks','headlines',
'todos','ids','conclude'), elapsed_seconds(int), notes(text)`.
`UNIQUE(meeting_id, segment_key)`. Notes are last-write-wins textareas; actual
minutes per segment live in `elapsed_seconds`.

### meeting_issues
`id, meeting_id FK, issue_id FK, state CHECK('in_ids','solved_today','carried')`.
`UNIQUE(meeting_id, issue_id)`. On conclude, non-solved rows flip to 'carried'
and the issues return to the long-term list (per spec).

### meeting_ratings
`id, meeting_id FK, person_id FK, score(int CHECK 1..10)`.
`UNIQUE(meeting_id, person_id)`. Trend = average per meeting over time.

## Cross-module links recap

- Rock (off-track ×2) → issue via `issues.origin='from_rock'`.
- Scorecard red cell → issue via `origin='from_scorecard'` + `origin_source_id`.
- Missed to-do → issue via `origin='from_todo'`.
- Issue solved in L10 → to-dos via `todos.issue_source_id`; the resolution row
  records `meeting_id`.
- To-do created in IDS → `todos.source_meeting_id`.

## Deliberately absent

No notifications tables, no uploads, no chat/comments, no multi-team hierarchy,
no dashboards/materialized rollups (rates are queries), no week/date-dimension
tables (derived), no auth beyond users+sessions.

## Access rules (enforced in server functions)

- **admin:** edit V/TO, seats/assignments, GWC, People Analyzer scores; set
  company rocks; edit all metrics; everything members can do.
- **member:** update own rock statuses, own to-dos, own assigned metrics;
  add issues; create/attend meetings; create to-dos for anyone.
- Everyone: view everything except other people's People Analyzer scores.

## Build-order note

Tables land in the build order from the README (foundation → accountability
chart → vto → todos → scorecard → issues → rocks → L10). The schema above is the
end state; each phase adds its tables plus any back-references (e.g., core
values exist before People Analyzer scores).