# Pilothouse — QA Testing Plan

*Manual test plan for reviewing all Pilothouse functionality. Sections 0–1 verified by John, 2026-09-11. Covers every module
(= every ticket 01–25), cross-module flows, and the permission matrix. Work
top to bottom; each case has steps and the expected result.*

## 0. Setup (once)

- [x] Start the app: `pnpm dev` (serves at http://localhost:3250; port 3000 is
      taken by the dev default script — use `node_modules/.bin/vite dev --port 3250`).
- [x] Sign in as the owner: `owner@pilothouse.local` / `Pilothouse-owner-dev`.
- [x] **Create a second (member) account** — there is deliberately no signup UI
      (accounts come from the seed; adding a creation UI was never a ticket).
      Run this, then restart the dev server so it seeds nothing weird:

      ```sql
      -- sqlite3 data/pilothouse.db
      INSERT INTO users (email, password_hash, name, role, created_at, updated_at)
      VALUES ('member@openeos.local',
        '<copy the owner's password_hash value and reuse it — same password>',
        'QA Member', 'member', datetime('now'), datetime('now'));
      ```

      Sign out, sign in as `member@openeos.local` (same password as owner) to
      confirm it works, then sign back in as owner.
- [x] Optional but recommended: create a second person ("QA Member") and link
      it to the member account (People page, admin) so permission tests below
      can distinguish "unlinked member" from "linked member".
- [x] Note: earlier QA data may already exist (items titled "QA validation…",
      "QA re-test…", 2 concluded meetings). Reuse or ignore it; nothing needs
      deleting (issues/goals/meetings are permanent by design).

**Recording:** tick each checkbox; mark ❗ next to anything that deviates from
the expected result (include what you saw).

---

## 1. Accounts & access (ticket 01)

- [x] 1.1 Sign out → visiting `/` redirects to the sign-in page.
- [x] 1.2 Wrong password → "Invalid email or password" style error; no session.
- [x] 1.3 Sign in → home shows your name, email, role, and the current
      quarter/week header ("2026 Q4 · Week of …").
- [x] 1.4 Close the browser, reopen → still signed in (session persists).
- [x] 1.5 As **member**: home shows member role; no admin-only controls anywhere.

## 2. People & linking (ticket 02)

*(admin)*
- [ ] 2.1 People page: create a person (name + email). Duplicate email → clear error.
- [ ] 2.2 Edit the person's name → saves.
- [ ] 2.3 Link the person to the member user account (Link account → select).
- [ ] 2.4 Unlink → the login shows "no login"; display name falls back to the
      account name.
*(member)*
- [ ] 2.5 People page is view-only — no Add/Edit/Link controls.

## 3. Quarters & week header (ticket 03)

- [ ] 3.1 Home header shows the current quarter and "Week of <Mon date>".
- [ ] 3.2 Quarter dropdowns (Goals, Issues) list current + next year's quarters.

## 4. Org Chart (tickets 04, 08)

- [ ] 4.1 Chart renders the tree; empty seats visually distinct from filled ones.
- [ ] 4.2 Create a seat with responsibilities (one per line) + parent → appears
      nested under its parent.
- [ ] 4.3 Assign a person to a seat → occupant shows on the seat and the seat
      detail; assignment appears in Assignment history with dates.
- [ ] 4.4 Assign the same person to a **third** seat → rejected (max two active).
- [ ] 4.5 Assign a second person to an occupied seat → rejected (one occupant).
- [ ] 4.6 End an assignment → seat becomes empty; the assignment moves to
      history with an end date (never deleted).
- [ ] 4.7 GWC: open a seat with an active assignment → set Get/Want/Capacity +
      note → Save → shown on the seat detail and the person's row.
- [ ] 4.8 *(member)* sees the chart and GWC read-only; no Edit/Assign/GWC buttons.

## 5. GWC (ticket 09)

- [ ] 5.1 GWC editor only appears for admins, on the **active** assignment.
- [ ] 5.2 Re-save overwrites (values update, history row keeps its own ratings).

## 6. Employee Assessment (ticket 10)

- [ ] 6.1 As admin: `/people/analyzer` — quarter selector, people × core-values
      grid, GWC summary column, verdict column ("Rate GWC first" when GWC
      incomplete).
- [ ] 6.2 Set +/−/−− scores; re-entering overwrites (no duplicate rows).
- [ ] 6.3 Rename a core value → scores still render under the new name.
- [ ] 6.4 Deactivate a core value → its past scores still visible in quarters
      that have them.
- [ ] 6.5 *(member)* visiting the analyzer → "admins only" message; direct API
      access denied.
- [ ] 6.6 Quarter selector defaults to the **current** quarter.

## 7. Company page (tickets 05–07)

- [ ] 7.1 Read view shows all eight questions; "published as of" date.
- [ ] 7.2 Edit (admin): fill core focus, 10-year target, marketing strategy
      (three uniques via list editor with add/remove/reorder), 3-Year Picture
      and 1-Year Plan (structured lists + numbers) → Save.
- [ ] 7.3 Save creates a version (history panel: "#N, timestamp, author,
      current"); "published as of" updates.
- [ ] 7.4 Edit again → save → restore version #1 → content reverts AND a new
      version is appended (originals never change).
- [ ] 7.5 Core values panel: add, rename (ID stays — scores unaffected),
      reorder (↑/↓), deactivate/reactivate.
- [ ] 7.6 Question 1 read view renders the ordered **active** values.
- [ ] 7.7 *(member)* no Edit button; the edit form is unreachable.

## 8. To-Dos (tickets 11–12)

- [ ] 8.1 Quick-add a to-do assigned to anyone → due date is exactly +7 days.
- [ ] 8.2 It appears in the assignee's "My to-dos" immediately.
- [ ] 8.3 Mark done → shows done; **Drop** → prompt requires a reason (blank
      refused).
- [ ] 8.4 Overdue open to-dos sort first and show red highlighting.
- [ ] 8.5 "Weekly view & rates": to-dos grouped by week; completion table
      (person + team, one decimal) over the 4 fully-elapsed weeks; dropped
      excluded; empty window shows "—".
- [ ] 8.6 Any member can complete/drop anyone's to-do (team property).

## 9. Data (the scorecard; tickets 13–15)

- [ ] 9.1 Add a metric (name, owner, target, direction ≥/≤, unit).
- [ ] 9.2 Enter a number for the current week in the grid → cell colors by
      direction (≥: actual ≥ target green; ≤: actual ≤ target green). Exact
      equality passes.
- [ ] 9.3 Re-enter the same week → overwrites (same cell, new value).
- [ ] 9.4 Re-target the metric, re-enter → past weeks still render against the
      target that was in force when each number was written.
- [ ] 9.5 Retire a metric → drops off the current grid; history still viewable
      (Trend). Reactivate restores it.
- [ ] 9.6 Trend panel: 12 weeks, bars colored pass/fail, missing weeks gray.
- [ ] 9.7 Rollup table: per-metric and per-owner on-track % (one decimal, "—"
      when no entries).
- [ ] 9.8 *(member)* can view the grid; can enter only for **their own**
      metrics; admin enters for any.

## 10. Issues (tickets 16, 20)

- [ ] 10.1 Add a long-term issue (defaults to current quarter) and a short-term
      one (no quarter field).
- [ ] 10.2 Age display ("this week", "2 wks") on each issue.
- [ ] 10.3 Resolve (Solved) → prompt requires a note → moves to "Resolved (N) —
      kept forever".
- [ ] 10.4 Drop → requires a reason → same archive.
- [ ] 10.5 Resolved issues are read-only (no edit) and stay in the archive.
- [ ] 10.6 Origin badges: create an issue from a goal/scorecard/todo (via the weekly-meeting
      push, section 12) → badge "from rock"/"from scorecard"/"from to-do"
      (internal origin values keep the old names — cosmetic only).
- [ ] 10.7 Quarter-end carry (admin, on an **ended** quarter's long-term list):
      carry-or-drop panel appears; Carry keeps the row and moves it to the
      chosen quarter; "Carry all" bulk-works; short-term issues are not
      offered.

## 11. Goals (tickets 17–19)

- [ ] 11.1 Add a company goal (admin) and a personal goal (member, "Me" only).
- [ ] 11.2 8th goal in a quarter → yellow warning banner (never blocks).
- [ ] 11.3 Target without direction (or vice versa) → rejected.
- [ ] 11.4 Weekly status: ✓ / ✗ / 📊 per goal per week; re-entering the same
      week overwrites; comment saved.
- [ ] 11.5 📊 measuring requires the goal to have a target; captures the
      actual number.
- [ ] 11.6 Two consecutive ✗ weeks → red ring / "off-track 2 weeks in a row".
- [ ] 11.7 Past quarter: everything read-only; admin sees ✓/✗ scoring buttons
      and the completion-percentage bars (EOS ~80% reference); unscored goals
      count as incomplete.
- [ ] 11.8 Carry over an unfinished goal to the next quarter → new goal with a
      "carried" badge; original untouched.

## 12. Weekly Meeting (tickets 21–25)

- [ ] 12.1 Start meeting → 7 segments in agenda order (Check-in 5 / Data 5 /
      Goals 5 / Headlines 5 / To-Dos 5 / Issues 60 / Conclude 5), first active
      with countdown.
- [ ] 12.2 Pre-loads: Data segment shows last week's column with pass/fail;
      Goals shows current statuses; To-Dos shows last week's bucket.
- [ ] 12.3 Advance → segment's actual time recorded, next starts; sub-second
      advance still marks it done.
- [ ] 12.4 Advancing Conclude is rejected (explicit conclude act).
- [ ] 12.5 **Two browsers** (owner + member): member's advances/notes appear in
      owner's view within ~2.5s and vice versa.
- [ ] 12.6 Notes: type in a segment textarea → autosaves (~1s after typing
      stops) → "saved" indicator → visible in the other browser.
- [ ] 12.7 Poll doesn't clobber a note you're actively typing (draft
      protection); a focused-but-untouched textarea may update.
- [ ] 12.8 Push: "Make issue" on a red scorecard cell, an off-track goal, and a
      missed to-do → each lands in the Issue queue with the right origin badge.
- [ ] 12.9 Duplicate push → no second queue row (idempotent).
- [ ] 12.10 IDS: pull an unresolved long-term issue; solve with note + to-do →
      queue row "solved today", resolution recorded, to-do created with
      meeting link + 7-day due.
- [ ] 12.11 Headline composer → manual issue in the queue.
- [ ] 12.12 Conclude: recap shows meeting to-dos; cascading messages saved in
      the conclude segment notes; remaining unsolved queue issues flip to
      "carried" (visible on the long-term list); solved ones stay solved.
- [ ] 12.13 Post-conclude freeze: advance / notes / push / pull / solve /
      facilitator / delete ALL rejected; ratings remain open.
- [ ] 12.14 Ratings: each participant rates 1–10 (0/11 rejected); one per
      person (re-rate overwrites); unlinked account → "link a person" error.
- [ ] 12.15 History: past meetings listed with date, avg rating; archive view
      is read-only with segment durations; rating trend across meetings.

## 13. Permission matrix (spot-check across modules)

| Action | admin | member |
|---|---|---|
| Edit the Company page, seats, Right Fit, Employee Assessment, company goals, any metric entry | ✅ | ❌ |
| View everything except other people's Analyzer scores | ✅ | ✅ |
| Create own goals, enter own metrics, add/resolve issues, push/solve in the Weekly Meeting | ✅ | ✅ |
| Conclude meeting, carry issues, score goals at quarter end | ✅ | ❌ |
| Rate meetings (linked account required) | ✅ | ✅ |

## 14. Known deferred items — do NOT file as bugs

- Creating **user accounts** has no UI (seed-only; SQL insert documented in §0).
- FK constraints on `issues.meeting_id`, `todos.source_meeting_id`,
  `todos.issue_source_id` are plain ints (conversion deferred — SQLite
  table-rebuild).
- History list rows show date + rating; durations are in the archive view.
- Emails are case-sensitive; a focused-but-pristine notes textarea may be
  updated by a poll (typed content is never lost).
- Measuring goals can't be pushed to the issue queue in v1; `from_meeting` origin unused.
- Recaps/dashboards, multi-team UI, notifications, integrations = Tier 3
  (out of scope per `docs/overview.md`).

## 15. When you find something

Note the module, the step number, what you did, what you expected vs saw. Most
behavior is pinned by the 195 seam tests (`pnpm test`), so a deviation likely
means either a UI-only issue or an undocumented expectation — both worth
writing down in the ticket files for a follow-up pass.