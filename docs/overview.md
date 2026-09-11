# Overview

App name: **Pilothouse**.

## What this is

A single-company EOS companion app. It digitizes the EOS toolset so the company can
run Vision, People, Data, Issues, Process, and Traction from one place instead of
whiteboards, spreadsheets, and loose notes.

Concrete users: the owner (Visionary/admin) plus 9 employees. Every employee has an
account and sees the vision, their seat, their rocks, their measurables, their to-dos,
and the team's scorecard and issues. Editing authority for vision and structure is
limited to admins; most day-to-day writes (rock updates, to-do completion, metric
entry, issue capture) are done by the owning person themselves.

## What it is not

- **Not multi-tenant SaaS.** One company, one database, one deployment. No billing,
  no onboarding funnel, no "create a workspace."
- **Not a general project/task manager.** Rocks and To-Dos are deliberately narrow
  (quarterly priorities and 7-day action items). No projects, epics, sprints, boards,
  or subtasks. Anyone who wants a real task manager keeps using the one they use.
- **Not a document/process system.** Core Process documentation (Tier 3) will at most
  link out to docs elsewhere; this app does not manage documents.
- **Not a communication tool.** No chat, no comments threads, no notifications firehose.
  Notifications, if any, are limited to EOS-relevant nudges (e.g., "rock update due").
- **Not a meeting recording or video tool.** Level 10s happen in-person or over
  whatever call service the company uses; this app is the shared agenda, timer, and
  note-taking surface.
- **No native mobile apps.** Responsive web only.
- **Not an OKR system.** Rocks are not OKRs. We intentionally do not build cascading
  objective trees, confidence sliders, or check-in rituals from the OKR world.

## Stack (decided)

- **Framework:** TanStack Start (SSR + server functions; all DB access server-side).
- **Database:** SQLite, local file, server-side only. Drizzle ORM via Node's
  built-in `node:sqlite` (sqlite-proxy driver; no native modules — chosen
  over better-sqlite3, which segfaults inside vite's dev module runner).
- **Styling:** Tailwind CSS.
- **Auth:** simple email + password with sessions stored in SQLite. No external
  identity provider.
- **DB roadmap:** local SQLite now; a move to a cloud DB (e.g., hosted Postgres or
  SQLite-compatible hosting) is likely later. Keep DB access behind server
  functions and the ORM layer so the swap stays contained.

## Global assumptions (correct me where wrong)

1. Single company, ~10 seats, single team in v1 (team model exists in schema but no
   team-management UI).
2. Real accounts for all 10 users; two roles initially: `admin` (owner) and `member`.
3. Quarters are calendar-aligned (Jan–Mar, Apr–Jun, …) but configurable offsets are
   allowed later; schema is quarter-scoped from day one.
4. The owner is the primary EOS Implementer/facilitator; the Level 10 timer and
   facilitation tools assume one facilitator per meeting but any member can start one.

## Out of scope for v1 overall (global cut line)

- Multi-team hierarchy and department scoping UI.
- Tier 3 items: Processes, meeting-pulse calendar, dashboards.
- Real-time websockets; live meeting view uses polling (see level-10 spec).
- File/image uploads of any kind.
- Importers/exporters beyond a full JSON export/backup.
- Email or push notifications (v1 may include none; decide before UI work).

## Open questions

None — all open questions are resolved.

## Decided

1. **App name:** Pilothouse.
2. **Week convention:** weeks run Monday–Sunday; the shared week utility derives
   week starts as Mondays and displays them as "Week of Mar 3".
3. **To-Dos: rate-first (Option A)** — v1 shows completion rates plus the
   in-meeting done/not-done list; dedicated recap views are a cheap later
   addition since the data is identical.
4. **People Analyzer visibility:** admin-only — scores are sensitive; members
   see their own data elsewhere, not peers' values scores.
5. **Backup strategy:** local backups for now (scheduled SQLite snapshot, e.g.
   `VACUUM INTO`). Cloud DB migration deferred; see stack note above.