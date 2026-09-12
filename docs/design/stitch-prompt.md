# Stitch Design Prompt — Pilothouse

Copy everything below the line into Stitch (with Google) as the design brief.
It describes every screen in the product and the design language to apply.

---

## Product

**Pilothouse** is a private web app that runs the operating system of a single
small company (~10 people). Every week the leadership team reviews the same
things: the numbers, the quarterly priorities, the to-do list, the issues, and
they run a timed weekly meeting. Pilothouse puts all of that in one place.

The name comes from the **pilothouse of a ship — the room where the captain
steers**. The design should quietly borrow that feeling: an instrument panel
for running a company. Crisp, calm, readable at a glance, professional. Think
"flight deck instrument cluster," not "airplane clip-art" — no cartoon planes,
no propellers, no camp. At most, subtle nods: instrument-style status colors,
checklist-like rows, a compass-quiet logo mark.

Two roles use the app: **admins** (owners/leadership — full control) and
**members** (employees — can view almost everything and manage their own
work). Views are desktop-first (this runs on a laptop in a meeting room), but
clean at narrower widths too.

## Design language

- **Modern and clean.** Generous whitespace, crisp 1px borders, soft shadows
  only where depth helps. Rounded corners (8–12px). No heavy gradients, no
  glassmorphism, no dark-mode-only aesthetics.
- **Typography:** a single professional sans (Inter or similar). Strong
  hierarchy: page title, section headings, quiet meta text. Numbers get
  tabular alignment — this app is full of data grids.
- **Palette:** calm, confident base — near-white surfaces, slate-gray text,
  one primary action color (deep navy or similar). Status colors carry
  meaning and are used consistently everywhere: **green = on track/passing,
  red = off track/failing/overdue, amber = warning, gray = neutral/unrated**.
  Think instrument-panel signal colors, muted rather than neon.
- **Components:** simple tables and cards, compact but tappable rows, pill
  badges for status, small inline icon buttons. Forms are plain labeled
  inputs — no wizardry.
- **Navigation:** a slim left sidebar or top bar with the section names
  (Home, Org Chart, People, To-Dos, Data, Goals, Issues, Company, Weekly
  Meeting, Users) plus a persistent week/quarter context indicator (e.g.,
  "Q3 2026 · Week of Sep 7") — time context matters on almost every screen.
- **Empty states** are friendly one-liners, never blank panels.

## Screens to design

### 1. Sign in

Minimal centered card: logo/wordmark "Pilothouse", email + password fields,
Sign in button. Nothing else on the page. Calm and confident — this is the
front door.

### 2. Users (admin only)

A simple account-management table: email, role (admin/member), the person
each account is linked to (or "unlinked"), and actions — create user (email +
password + role), reset password (generates a temp password), flip role.
Includes a guard note: admins cannot change their own role. Utilitarian,
dense but tidy — a settings page, not a dashboard.

### 3. People

The roster of employees. A table: name, email, start date, linked-account
indicator, and row actions (Edit, Link account, view detail). A detail panel
per person shows their seat history on the org chart with Right Fit ratings
and dates. Admin sees "Add person" and "Employee Assessment" links; members
see the same table read-only. Clean data-table design with quiet row hover.

### 4. Org Chart

An interactive **tree** of seats (roles like "CEO", "Head of Product"),
rendered top-down with connecting lines: filled seats show the occupant's
name; empty seats are visually distinct (dashed outline). Selecting a seat
opens a detail panel: seat name, responsibilities (numbered list), current
occupant with a Right Fit summary ("Right Fit — Get ✓ · Want ✓ · Capacity ✓"),
an **Unassign** button, assignment history (start → end dates), and an
"Assign person" action. Admin gets Add/Edit seat controls; members see it
read-only. The chart should feel like a clean whiteboard — boxes, lines,
names — not a node-graph tech demo.

### 5. To-Dos

Three zones on one page: a quick-add bar (title + assignee picker, due date
auto = +7 days), **"My to-dos"** (the signed-in user's list), and **"All open
(team)"** — every open to-do with owner names. Overdue items sort first and
render with red styling and "(overdue)". Each row has Done and Drop actions
(drop requires a reason). A "Weekly view & rates" section groups to-dos by
week in columns and shows a small completion-rate table (person + team, one
decimal). Checklist energy: simple rows, clear completion states.

### 6. Data

The company scorecard. A **weekly grid**: metrics as rows, the last 8 weeks
as columns, each cell showing the number colored green (met target) or red
(missed) against that metric's target (≥ or ≤ direction) and unit — e.g.,
"ARR ≥ 100 $". Below: a **Trend panel** per metric (12-week bar chart, bars
green/red, missing weeks gray) and a **Rollup table** (on-track % per metric
and per owner, one decimal). Admins add/retire metrics (name, owner, target,
direction, unit); members can enter numbers only for metrics they own. The
grid is the hero: tabular numbers, precise, instrument-panel clean.

### 7. Goals (quarterly priorities)

Quarter-scoped board of the team's 3–7 quarterly goals (a "company goal"
plus personal goals). Each goal: statement, owner, optional measurable target
(direction + number), and a **weekly status grid**: ✓ on track / ✗ off track /
📊 measuring per week, re-enterable. Two consecutive off-track weeks light up
a red "off-track 2 weeks in a row" indicator. A soft warning banner appears
when an 8th goal is added (never blocks). For ended quarters: read-only view
with completion-percentage bars and an ~80% norm reference. Unfinished goals
can be carried into the next quarter (marked "carried"). Design: vertical
goal cards with a compact status strip — weekly statuses read like a tiny
flight log.

### 8. Issues

Two tabs: **Short-term** (this week's list — the default) and **Long-term**
(quarter-scoped). Each issue: one-line title phrased as a solution, owner,
age display ("this week", "2 wks"), and a small origin badge when it was
created from elsewhere ("from goal", "from data", "from to-do", "from
meeting"). Actions: **Solved** (requires a resolution note) and **Drop**
(requires a reason) — both move it to a "Resolved (N)" archive that is kept
forever and read-only. At quarter end, admins get a carry-or-drop panel to
move unresolved long-term issues into the next quarter. Clean two-column
list rhythm: open issues on top, archive collapsed below.

### 9. Company

The company's vision on one page, presented as eight answered questions in
reading order: What are our core values? What is our core focus? What is our
10-year target? What is our marketing strategy (three uniques)? What is our
3-year picture? What is our 1-year plan (with annual goals and numbers)? The
read view is a polished document layout — typographic, calm, like a well-set
strategy one-pager — with a "published as of" date. Admins get an Edit mode
with structured form fields and list editors (reorderable three-uniques
list, value lists). Every save creates a **version**; a History panel lists
"#N · timestamp · author · current" and any version can be restored
(restores append a new version, originals never change). Core values are
managed here too: add, rename, reorder, deactivate.

### 10. Weekly Meeting

The heart of the app — design it like a **meeting cockpit**:

- Header: "Meeting of <date>", total elapsed time, "N/7 segments done", a
  facilitator picker, and a Delete meeting action.
- **Seven segment cards** in agenda order, each with allotted time:
  Check-in (5) · Data (5) · Goals (5) · Headlines (5) · To-Dos (5) ·
  Issues (60) · Conclude (5). The active segment is visually highlighted
  with a live countdown; done segments show their actual duration; upcoming
  ones are dimmed. An **Advance** button moves to the next segment.
- A **pre-loads panel** (Data / Goals / To-Dos): last week's scorecard
  column with pass/fail coloring, current goal statuses (off-track ones
  pulsing red with a "Make issue" push button), and last week's to-do
  bucket (done/dropped counts).
- An **Issue queue**: pulled long-term issues and freshly pushed items, each
  row solvable inline — pick a resolution note, optionally create a 7-day
  to-do from it; solved rows stamp "solved today".
- A **Conclude panel**: each participant picks a 1–10 meeting rating from a
  dropdown; the panel shows "N new to-dos · N to carry back · avg rating";
  "Conclude meeting (freeze)" locks everything — afterwards the meeting is
  read-only except ratings.
- A **History list** of past meetings (date, avg rating) with a read-only
  archive view showing per-segment durations.

Design cue: the segment rail should read like a checklist being flown —
current item lit, completed items checked, everything else quiet.

## General notes

- Use **Pilothouse** terminology exactly: Org Chart, People, To-Dos, Data,
  Goals, Issues, Company, Weekly Meeting, Right Fit, Employee Assessment.
- Status semantics are global: green/on-track, red/off-track, amber/warning,
  gray/unrated. Reuse the same badge styles on every screen.
- The week/quarter context ("Week of Sep 7", "2026 Q3") should be visible on
  any screen where time matters (To-Dos, Data, Goals, Issues, Meeting).
- Professional and restrained throughout: this is a tool a leadership team
  sees every Monday morning — calm confidence, zero clutter.