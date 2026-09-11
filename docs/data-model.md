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

Ticket 07 decisions: rows are **never deleted** (deactivation flips `active`);
name uniqueness is **case-insensitive** (`COLLATE NOCASE` unique index) across
all rows, active and inactive; the default list is **active-only** (read view
and future scorers consume it — admins fetch inactive rows explicitly);
reordering assigns contiguous `sort_order` 0..n-1 from a complete ID list.

### people_analyzer_scores
`person_id FK→people, quarter_id FK→quarters, core_value_id FK→core_values,
score TEXT CHECK IN ('+','-','--')`, `UNIQUE(person_id, quarter_id,
core_value_id)` — re-entering overwrites. Status (ticket 10): implemented.
Display names are JOINED from `core_values`/`people` at read time (never
denormalized). Grid columns = active values, then inactive values that still
hold scores for the selected quarter (historical scores stay visible). GWC
summary column rolls up from ACTIVE seat assignments (ended ones excluded);
the "right person / right seat" verdict is derived (GWC first, then scores).
ADMIN-ONLY view and edit at the seam.

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

Ticket-17 deltas: `team_id` omitted (single company, same as todos); column
sketched as `target_direction` is named `direction` (mirrors metrics);
`completed`/`completed_at` exist from creation but are only written at quarter
end (ticket 19). Writes to quarters whose `end_date` has passed are rejected
(`quarter_read_only`) — the freeze boundary is the calendar date, applied from
ticket 17 onward so history can never be edited. Permission: admins create
company rocks (owner NULL) and personal rocks for anyone; members create/edit
only their own personal rocks.
| column | type | notes |
| --- | --- | --- |
| id | int pk | |
| quarter_id | int FK→quarters | |
| team_id | int FK→teams | |
| owner_person_id | int FK→people, nullable | NULL = company rock |
| statement | text | verb + what + done-by |
| detail | text nullable | few sentences max |
| target | real nullable | measuring rocks only |
| target_direction | text CHECK('gte','lte') | co-occurs with target (no default; binary rocks have neither — ticket-17 decision) |
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
`measuring` requires a non-null rock target AND the week's actual (rejected,
not ignored, on non-measuring statuses too); comments are one line, capped at
200 chars; entry permissions mirror the scorecard (admin any, owner own).
2-consecutive-off-track: an entry is flagged when it and the entry with the
adjacent preceding week key (exactly 7 days earlier) are both off_track —
adjacent week keys, not same-month days; the rock is highlighted when its
LATEST entry is flagged. `entry_by` mirrors metric_entries (data-model
sketched `updated_by`); writer column names stay one-spelling-per-concept.
The 2-consecutive-off-track
highlight is a query, not stored state.

### Quarter-end scoring + carry-over (ticket 19)

- **Scoring:** `scoreRock` (admin-only) sets `completed` 0/1 + `completed_at`.
  Only rocks in an ENDED quarter (end_date < today — the same single freeze
  boundary as all rock writes) are scorable; a quarter ending today is not yet
  scorable (pinned). Re-scoring is allowed for any ended quarter for now —
  documented delta: the data-model originally suggested freezing history one
  quarter out; the lean v1 keeps re-scoring open.
- **Completion-rate denominator (decided):** every rock in the quarter counts
  — unscored rocks are "incomplete by omission" and sit in the denominator as
  not-done. Rate = completed/total, one decimal, null only for zero rocks.
  Buckets: per person, company rocks (owner NULL) as their own "Company" row,
  plus the team aggregate.
- **Carry-over:** `carryOverRock` (admin-only) creates a NEW rock in the
  target quarter copying statement/detail/owner/target/direction with
  `carried_over_from_rock_id` = source. Source rock is NEVER mutated. Source
  quarter must be ended; target quarter must be current/future (the same
  quarterWritable check). The UI's carry button targets the quarter after the
  one being viewed.

## Scorecard tables

### metrics
`id, team_id, name, owner_person_id, target(real), direction CHECK('gte','lte'),
unit(text), active(0/1), created_at, updated_at`.
Definitions are not quarter-scoped (active flag + entry-time targets handle
retirement and re-targeting; targets change at quarter boundaries by convention).
Implemented (ticket 13): `team_id` omitted like other tables (single company);
targets are REAL with **any finite value allowed, including 0 and negatives**
(seam validates finiteness only — numeric strings are coerced and accepted, "defects" can target 0); `listMetrics`
`includeInactive` is admin-gated (ticket-07 rule).

### metric_entries
`id, metric_id FK, week (date, a Monday), actual(real), target_at_entry(real),
entry_by FK→users, created_at, updated_at` (ticket 14 naming: `actual`/`entry_by`;
`entered_at` is covered by created_at/updated_at since a re-entry IS the
update). `UNIQUE(metric_id, week)` — weekly overwrite. Re-entry overwrites
`actual` AND re-captures `target_at_entry` from the current target (the
history basis is "the target in force when the number was last written";
a re-target changes how past weeks render — decided). A direction flip
(gte↔lte) likewise re-renders all history under the new direction — same
decided basis, current definition in force. Week inputs accept
any day and normalize to that week's Monday via `weekStart`. Entry
permissions: admin any metric, the metric's owner their own. TOCTOU note:
target capture is read-then-write without a transaction (proxy driver has
no verified transaction wrapper); single-process SQLite makes the race
vanishingly unlikely and self-healing on the next overwrite.

Ticket 15 (trend + rollups, derived on read — NO rollup tables): the
per-metric trend is the last 12 weeks ending with the current week; trend
pass values derive at read time (retired metrics still trend). Rollup
formula: a metric's "on-track %" = pass-entries ÷ ALL window entries for
that metric; weeks WITHOUT entries are excluded from both sides (a missing
number is not a miss — only reported weeks are judged); a metric with no
window entries gets a null rate (rendered "—"). The rollup window is the 12
most recent weeks INCLUDING the current week (entries land during their
week) — documented delta vs ticket 12's to-do rate, which uses
fully-elapsed weeks only (different discipline, different window). Owner
and team rates aggregate only metrics that have window entries; rollups
include retired metrics' in-window entries (history is judged, not hidden).

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

Ticket-20 provenance + carry decisions: origin issues are long_term in the
CURRENT quarter (where IDS works), regardless of the source row's quarter;
duplicates are allowed (the room may push the same red cell twice — the L10's
meeting_issues UNIQUE handles in-meeting dedup); red-cell pushes
verify pass via the metric's current direction (metrics.derivePass) and reject
green cells ('not_red'); completed to-dos are not misses ('todo_not_missed').
Quarter-end carry = the lean keep-row (quarter_id updated in place); the
from-quarter must be ENDED (strict `<`, same freeze boundary — a quarter
ending today is not yet carryable) and the target quarter must NOT be ended;
bulk carry returns the count and leaves resolved rows as history.

Ticket-23 queue decisions: a duplicate push to the same meeting is
IDEMPOTENT — it returns ok (alreadyQueued) instead of an error, and the
UNIQUE index keeps exactly one row (the room never sees a push error for
pushing twice). Rock pushes verify the rock's LATEST weekly status is
off_track (or the 2-consecutive flag) and reject otherwise ('not_off_track');
measuring rocks are not pushable in v1 — their status is a number, not a
verdict. Headlines are free text with no source row, so a headline pushes as
a 'manual' issue (origin 'from_meeting' stays unused in v1 — documented).
Push helpers are two-step (issue create → queue insert) without a
transaction; a crash between steps self-heals by pushing again. Queue
removal (any participant) deletes only 'in_ids' rows; 'solved_today'/'carried'
rows are conclude-state (ticket 25), and the issue itself always persists.

Status is derived: open until an `issue_resolutions` row exists.

### issue_resolutions
`id, issue_id FK, meeting_id FK→meetings nullable, outcome CHECK('solved','dropped'),
note, resolved_by, resolved_at`. Implemented (ticket 16): immutable
(no updated_at, never edited/deleted), `UNIQUE(issue_id)` makes the
write-once rule structural; `note` is required for BOTH outcomes (solved
captures the decision, dropped captures the reason — same honesty rule as
dropped to-dos); `meeting_id` is a plain nullable int until the meetings
table lands (ticket 21). `issues` naming delta: `added_by`/`added_at` →
`created_by`→users + base `created_at` (login account acts, linked or not);
`sort_order` exists but v1 keeps it at 0 (creation order via the
created_at tie-break; no reorder API). Long-term issues default to the
current quarter when no quarter is passed; short-term issues reject a
quarter (their context is the derived week). Carry-forward is explicit: an unresolved
long-term issue at quarter end prompts carry-or-drop (UI behavior; carried items
re-attach to the new quarter as new rows or keep the row and re-point
`quarter_id` — implementation detail, decide at build: lean keep-row + update
`quarter_id`).

## To-Dos tables

### todos
| column | type | notes |
| --- | --- | --- |
| id | int pk | |
| team_id | int FK→teams | omitted in v1 (single company; no teams table) — add with team scoping |
| title | text | one line only |
| assignee_person_id | int FK→people | exactly one |
| created_by | int FK→**users** | implemented as the login account (ticket 11): any signed-in user can create, linked or not; switch to people-FK only if creation ever requires a linked person |
| source_meeting_id | int FK→meetings, nullable | plain int until meetings table exists (ticket 21) |
| issue_source_id | int FK→issues, nullable | plain int until issues table exists (ticket 16) |
| created_at | text | |
| due_date | text (date) | created_at + 7 days (decided) |
| status | text CHECK('open','done','dropped') | |
| completed_at | text nullable | |
| drop_reason | text nullable | required when dropped |

Completion rates derive from this table — no rollup tables (spec).

**Completion-rate formula (ticket 12, implemented in the todos module):** the
window is the 4 fully-elapsed weeks before the week containing "as of" (default
Today), i.e. due dates in `[weekStart(asOf) − 28 days, weekStart(asOf) − 1 day]`
— a week that hasn't ended cannot be scored. **Counted (denominator)** = to-dos
due in the window with status done OR open (open-and-past-due = missed — that's
the honesty). **Done (numerator)** = status done. **Dropped to-dos are excluded
from both sides**: a to-do deliberately dropped with a reason was never going
to be done, so it counts neither for nor against. rate = done ÷ counted × 100,
one decimal, null when nothing counted; computed per person and team on every
call. Team view weeks are derived via `weekStart(due_date)` (never stored).

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
minutes per segment live in `elapsed_seconds`. Ticket 22 semantics: saves are
any-participant on open meetings only, with a 100KB cap (`SEGMENT_NOTES_MAX`,
abuse bound — rejected writes persist nothing). Polling clients re-fetch via
`getMeeting` (cheap: summary + segments; pre-loads are a separate call and are
NOT re-run per poll — no state-only variant needed). Client UX: debounced
~800ms autosave, skip-while-editing (a DIRTY — typed-in — textarea is never
clobbered by the poll; a focused-but-pristine one may be updated by the
poll; other participants' notes apply when you're not editing), 2.5s poll
interval.

**Segment state machine (ticket 21, implemented):** planned minutes are NOT
stored — they come from the fixed agenda constant in the meetings module
(Segue 5 / Scorecard 5 / Rocks 5 / Headlines 5 / To-Dos 5 / IDS 60 /
Conclude 5). Each segment row carries `entered_at` (when it became current —
added column, documented delta) and `done_at` (set on advance; distinguishes a
sub-second segment from an active one). Start creates all 7 rows in agenda
order with the FIRST segment active. The active segment is the unique row with
`entered_at != null AND done_at IS NULL`. Advance stamps
`elapsed_seconds = now − entered_at` + `done_at`, and activates the next.
Advancing `conclude` is rejected — concluding the meeting is ticket 25's
explicit act, not a timer advance. One OPEN meeting per company at a time
(app-enforced; `team_id` omitted — single-company delta). Open meetings
hard-delete (meeting + segments); concluded meetings are frozen. Advisory
facilitator: any signed-in user sets/clears it; no permissions attach.
Meetings `team_id`/`date`: `date` is the meeting day. `issues.meeting_id` and
`todos.source_meeting_id` remain plain ints (FK conversion deferred — the
cross-module integrity is enforced at the seam; a SQLite FK addition would
require table rebuilds).

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
- **member:** update own rock statuses, own assigned metrics; add issues;
  create/attend meetings; create to-dos for anyone. (Ticket 11 decision:
  completing/dropping a to-do is any-member too — to-dos are team-visible
  commitments, not private items; the spec's drop-reason honesty argument
  doesn't depend on who drops. "Own to-dos" bounds what members must be able
  to do, not a limit.)
- Everyone: view everything except other people's People Analyzer scores.

## Build-order note

Tables land in the build order from the README (foundation → accountability
chart → vto → todos → scorecard → issues → rocks → L10). The schema above is the
end state; each phase adds its tables plus any back-references (e.g., core
values exist before People Analyzer scores).