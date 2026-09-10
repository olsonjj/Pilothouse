# OpenEOS — Execution Plan

*Spec produced from the docs in this repository (`overview.md`, `data-model.md`,
and `specs/*`). All decisions referenced here are already decided in those
documents; this spec turns them into an implementable plan.*

## Problem Statement

OpenEOS's owner runs a ~10-person company on the Entrepreneurial Operating System
(per *Traction*). Today the EOS toolset — vision, accountability chart, rocks,
weekly Level 10 meetings, scorecard, issues, and to-dos — is tracked across
whiteboards, spreadsheets, and loose notes. Nothing enforces the meeting pulse,
nothing rolls up completion, and the shared picture of "where we are" lives in
one person's head. Off-the-shelf EOS SaaS exists but is per-seat priced,
multi-tenant, and generic; the owner wants a tool tailored exactly to the
company, that the whole team runs on.

## Solution

A single-company web application, OpenEOS, that digitizes the Tier 1 and Tier 2
EOS tools for all 10 users: an Accountability Chart (seats, GWC, People
Analyzer), a versioned V/TO, quarter-scoped Rocks with weekly traffic-light
status, the Level 10 Meeting as a live shared companion (timed agenda, polling,
archives), a weekly Scorecard grid, long/short-term Issues Lists with
carry-forward, and 7-day To-Dos with completion rates. Built on TanStack Start,
Tailwind CSS, and a local SQLite database accessed only through server
functions, with simple email+password auth. Delivered in the dependency order:
foundation → Accountability Chart → V/TO → To-Dos → Scorecard → Issues → Rocks
→ Level 10 Meeting.

## User Stories

### Accounts & access (foundation)

1. As an employee, I want to sign in with my email and password, so that my
   updates are attributed to me.
2. As an employee, I want my session to persist between visits, so that I don't
   log in every morning.
3. As the owner, I want two roles (admin/member), so that vision and structure
   edits stay with me while everyone can work day-to-day.
4. As the owner, I want to create accounts for my 9 employees, so that the
   whole team can use the app.
5. As any user, I want to see only what I'm allowed to edit, so that I don't
   waste time on screens I can't act on.

### Accountability Chart

6. As the owner, I want to define seats with names, descriptions, and ordered
   responsibilities, so that every role's accountability is explicit.
7. As the owner, I want to arrange seats in a reporting hierarchy, so that the
   chart reflects who reports to whom.
8. As the owner, I want empty seats visible on the chart, so that hiring gaps
   are obvious to everyone.
9. As the owner, I want to assign a person to up to two seats, so that small
   company multi-hatting is reflected honestly.
10. As an employee, I want to view the chart and any seat's detail, so that I
    understand my role and everyone else's.
11. As the owner, I want to record GWC (Get it / Want it / Capacity) per
    person-per-seat with a note, so that right-person/right-seat decisions are
    grounded in data.
12. As the owner, I want to score each person each quarter against each core
    value on the +/−/−− scale, so that the People Analyzer reflects current
    reality.
13. As the owner, I want People Analyzer scores to be visible to admins only,
    so that sensitive assessments stay confidential.
14. As the owner, I want seat assignment history (who held a seat and when), so
    that reorganizations don't erase the past.

### V/TO

15. As an employee, I want to read the full two-page V/TO (all eight questions)
    at any time, so that I share the company's vision.
16. As the owner, I want to edit every V/TO question with structured forms, so
    that the document stays well-formed.
17. As the owner, I want each save to create a restorable version snapshot, so
    that vision history is never lost.
18. As the owner, I want to manage the core values list (name, description,
    order, active flag), so that the People Analyzer scores against the current
    set while old scores stay intact.
19. As an employee, I want to see the "published as of" date on the V/TO, so
    that I know how current the vision is.

### Rocks

20. As the owner, I want to set 3–7 company rocks per quarter, so that the
    team's quarterly priorities are explicit.
21. As an employee, I want to set my own 3–7 personal rocks per quarter, so
    that my quarter is planned around what matters.
22. As an admin, I want a soft warning above 7 rocks, so that rock-setting
    discipline is nudged, not enforced.
23. As a rock owner, I want to mark my rock on-track or off-track once a week
    with an optional one-line comment, so that the team sees weekly status.
24. As a rock owner with a target-based rock, I want to report "measuring" with
    the week's actual number against my target, so that numeric progress is
    tracked.
25. As any user, I want a rock that has been off-track two consecutive weeks to
    be visually highlighted, so that it gets attention (and becomes an issue).
26. As the owner, I want to explicitly carry an unfinished rock into the next
    quarter, so that carry-overs are visible and never silent.
27. As the owner, I want rocks marked complete/incomplete at quarter end, so
    that completion percentage per person and team (~80% norm) is computed.
28. As any user, I want past quarters' rocks to be read-only history, so that
    scoring is trustworthy.
29. As the owner, I want one-click creation of an issue from a chronically
    off-track rock, so that the problem enters the Issues discipline.

### Level 10 Meeting

30. As any member, I want to start this week's L10 meeting, so that the meeting
    has a shared live surface.
31. As any participant, I want the meeting pre-loaded with the previous week's
    scorecard, current rock statuses, and last week's to-dos, so that no time
    is spent gathering data.
32. As any participant, I want a per-segment countdown timer (Segue 5 /
    Scorecard 5 / Rocks 5 / Headlines 5 / To-Dos 5 / IDS 60 / Conclude 5), so
    that the meeting keeps its cadence.
33. As any participant, I want anyone able to advance segments (advisory
    facilitator label), so that the meeting never stalls on a role.
34. As any participant, I want shared per-segment notes with autosave, so that
    the meeting record builds live.
35. As any participant, I want everyone's updates visible within a few seconds
    (polling), so that the screen is genuinely shared.
36. As any participant, I want "make this an issue" buttons on red scorecard
    cells, off-track rocks, and missed to-dos, so that the L10 discipline of
    "not solved in 5 minutes becomes an issue" is one click.
37. As any participant, I want to pull long-term issues into the meeting's IDS
    queue, so that backlog items get their 60 minutes.
38. As any participant, I want to solve an issue in-session by capturing a
    resolution note and creating assigned to-dos, so that IDS produces action.
39. As any participant, I want unsolved issues to return to the long-term list
    on conclude, so that nothing is lost.
40. As any participant, I want the Conclude segment to recap new to-dos,
    capture cascading messages, and record my 1–10 rating, so that the meeting
    ends with accountability.
41. As the owner, I want each concluded meeting frozen as an archive (notes,
    issues, to-dos, ratings, durations), so that history is immutable.
42. As the owner, I want per-meeting rating averages trended over time, so that
    meeting health is visible.

### Scorecard

43. As the owner, I want to define 5–15 weekly metrics with owner, target,
    comparison direction, and unit, so that the team's weekly pulse is explicit.
44. As a metric owner, I want to enter one number per metric per week, so that
    the grid stays truthful.
45. As any user, I want green/red derived automatically from target comparison,
    so that status is never hand-painted.
46. As any user, I want an 8–12 week trend view (simple bars) per metric, so
    that trajectory is obvious at a glance.
47. As any user, I want a trailing-quarter "weeks on-track %" rollup per metric
    and owner, so that consistency is measured.
48. As the owner, I want to re-target metrics at quarter boundaries with history
    rendered against the target in force that week, so that re-targeting doesn't
    falsify the past.
49. As the owner, I want one-click issue creation from red cells in the L10, so
    that misses become solvable problems.

### Issues

50. As any member, I want to add one-line issues to the team's long-term or
    short-term list, so that problems are captured where they'll be solved.
51. As any user, I want each issue's origin (manual, from rock/scorecard/
    to-do/meeting) recorded, so that context is never lost.
52. As any user, I want issues to display their age, so that stale items stand
    out.
53. As the owner, I want an explicit carry-or-drop prompt for unresolved
    long-term issues at quarter end, so that nothing expires silently.
54. As any user, I want solved issues to keep their resolution notes and
    created to-dos, so that decisions are traceable forever.
55. As the owner, I want a searchable archive of solved issues across quarters,
    so that past solutions are findable.

### To-Dos

56. As any member, I want to quick-add a to-do assigned to anyone with a 7-day
    due date, so that commitments don't wait for a meeting.
57. As an employee, I want a "my to-dos" list sorted by due date, so that I know
    what's mine this week.
58. As any user, I want to mark a to-do done or drop it with a one-line reason,
    so that the completion rate stays honest.
59. As any user, I want the team's 4-week completion rate per person and team,
    so that the ~90% EOS norm is visible.
60. As any user, I want overdue open to-dos surfaced first, so that slippage is
    impossible to miss.
61. As any participant, I want last week's to-dos shown done/not-done in the L10
    with one-click issue creation on misses, so that the To-Do segment takes
    five minutes, not twenty.

### Cross-cutting

62. As any user, I want a Monday-start week convention everywhere (rocks,
    scorecard, to-dos), so that "this week" always means the same thing.
63. As the owner, I want the database to stay behind server functions with no
    client DB access, so that a later cloud-DB migration is contained.
64. As the owner, I want scheduled local SQLite snapshots, so that data loss is
    a non-event.

## Implementation Decisions

1. **Stack:** TanStack Start (SSR + server functions), Tailwind CSS, SQLite via
   Drizzle ORM (planned), email+password auth with sessions in SQLite.
2. **Build order (phases, each independently usable):**
   - **Phase 0 — Foundation:** project scaffold, auth (users, sessions), people,
     seats, seat_assignments, teams (single row), quarters (seeded current+next
     year), the shared `weekStart()` Monday helper, base-fields schema helper
     (id + created_at + updated_at on mutable tables), backup snapshot job.
   - **Phase 1 — Accountability Chart:** chart view, seat/person detail, GWC,
     People Analyzer.
   - **Phase 2 — V/TO:** eight questions as forms, versioned snapshots,
     core_values management.
   - **Phase 3 — To-Dos:** quick-add, my-to-dos, team week view, completion
     rates, drop-with-reason.
   - **Phase 4 — Scorecard:** metric CRUD, weekly grid, traffic lights, CSS
     trend bars, rollups.
   - **Phase 5 — Issues:** CRUD, classification, origin tracking, aging,
     quarter-end carry prompts.
   - **Phase 6 — Rocks:** quarter lifecycle, weekly statuses, measuring rocks,
     quarter-end scoring, explicit carry-over.
   - **Phase 7 — Level 10 Meeting:** start/conclude, segment timer, notes,
     polling live view, issue push/pull, to-do creation, ratings, frozen
     archives.
3. **Schema** per `data-model.md`: integer PKs; ISO-8601 text timestamps/dates;
   TEXT+CHECK enums; weeks derived via `weekStart()` (never stored); UNIQUE
   constraints for weekly overwrite (`rock_statuses`, `metric_entries`), meeting
   uniqueness (`meeting_issues`, `meeting_ratings`, `meeting_segments`);
   `core_values` as first-class rows outside V/TO snapshots; issue status
   derived from resolution rows; `origin`+`origin_source_id` provenance on
   issues; completion rates always derived (no rollup tables).
4. **App-enforced constraints:** ≤2 active seats per person; one active occupant
   per seat; `measuring` status requires a rock target; 7-rock soft warnings.
5. **Access model (server-function enforced):** admins edit V/TO, seats,
   assignments, GWC, People Analyzer, company rocks, all metrics; members edit
   their own rock statuses, to-dos, assigned metrics; everyone views everything
   except others' People Analyzer scores; all DB access lives behind server
   functions (client never touches the DB).
6. **Realtime:** 2–3s polling on the meeting view; per-segment notes are
   last-write-wins textareas with autosave; no websockets/SSE.
7. **Meetings:** advisory facilitator; open meetings deletable; concluded
   meetings frozen; on conclude, unsolved meeting_issues flip to 'carried' and
   return to the long-term list; to-dos created in-session default due
   created_at + 7 days.
8. **Quarter mechanics:** quarters calendar-aligned; rock carry-over is explicit
   (new rock row referencing `carried_over_from_rock_id`); unresolved long-term
   issues at quarter end prompt carry-or-drop (carry = keep row, update
   `quarter_id` — lean, confirm at build); quarter-end rock completion is a
   distinct admin action producing read-only history.
9. **UI approach:** responsive Tailwind; hand-rolled nested-tree chart (depth
   2–3); CSS-bar trends (no chart library); no drag-and-drop in v1.
10. **No** notifications, uploads, chat/comments, native apps, calendar
    integration, chart library, task-manager features, or multi-team UI (team
    scoping exists in schema only).

## Testing Decisions

1. **Single seam: module server functions against a real SQLite database** (temp
   file per test run). All business rules — access control, weekly overwrite,
   caps, status derivation, carry-over, completion rates, quarter transitions —
   are tested through this seam, not through UI or internals. This is the
   highest seam that exists: server functions are the app's only mutation and
   query boundary.
2. **One exception:** the `weekStart()` helper and rate/percentage calculators
   are pure functions with tricky date math (month/quarter boundaries) — unit
   tests directly, since mocking DB state to exercise a Feb-29 or quarter-edge
   bug through the seam would be disproportionate.
3. **Good tests** assert external behavior only: given seeded state, calling a
   server function yields a return value, a persisted effect, or a rejection.
   No assertions on SQL text, function internals, or component structure.
4. **Prior art:** none — greenfield. Establish the pattern in Phase 0 (auth +
   people + `weekStart` tests) and follow it for every phase.
5. **Per-phase test focus:**
   - Foundation: auth flows, session expiry, role checks, `weekStart` edge cases.
   - Accountability Chart: two-seat cap, one-occupant-per-seat, GWC writes,
     admin-only People Analyzer.
   - V/TO: version snapshot on save, restore-as-new-version, core-value editing
     keeping old scores intact.
   - To-Dos: 7-day due-date default, drop-reason requirement, completion-rate
     math.
   - Scorecard: one-entry-per-week overwrite, `target_at_entry` history,
     direction-aware pass/fail.
   - Issues: origin recording, derived status, carry prompt logic.
   - Rocks: weekly overwrite, measuring-requires-target, quarter-end scoring,
     explicit carry-over, read-only past quarters.
   - L10: segment lifecycle, conclude freezing, unsolved issues carrying back,
     to-do creation with 7-day dues, ratings.

## Out of Scope

- Everything in `overview.md`'s global cut line: multi-tenant SaaS, billing,
  native mobile apps, file uploads, websockets, email/push notifications,
  importers beyond JSON backup, Tier 3 (Processes, meeting-pulse calendar,
  dashboards).
- OKR cascades, task-manager features (boards, subtasks, recurring to-dos),
  HR/recruiting workflows, comments/threads, private to-dos or notes.
- Scorecard data integrations (Stripe/CRM/etc.).
- Recap screens for to-dos (data supports them later; rate-first decided).
- Drag-and-drop chart editing, per-person issue views, solved-issue purge,
  V/TO read acknowledgements, cancelled-meeting states.

## Further Notes

- All 13 previously-open questions are decided in the docs; the only
  implementation-time choice left is the issue carry-forward mechanism (lean:
  keep row, update `quarter_id`), noted in the data model.
- App name is OpenEOS; the repository working title was my-eos.
- The DB roadmap note (overview stack section) is binding: keep all DB access in
  server functions and behind the Drizzle layer so a later cloud-DB swap stays
  contained.
- Phases map one-to-one onto the build order in `docs/README.md`; each phase
  ends with the app fully usable with what exists so far.