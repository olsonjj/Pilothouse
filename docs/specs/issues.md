# Issues Lists

## Purpose (EOS context)

The Issues List is where the team lists everything that stands between it and its
vision, and solves them through IDS (Identify — agree on the real problem;
Discuss — everyone's opinion, no politics; Solve — a decision and usually a to-do).
EOS keeps two lists per team: a **long-term (3-month) issues list** for items
needing attention at some point in the quarter, and a **short-term (7-day) list**
for items to be solved within a week. Issues flow into the weekly L10's IDS block.

## What it is

A per-team issues list with long/short-term classification, IDS support inside
meetings, and carry-forward behavior.

### Issues

- One-line title (issues are phrased as specific statements, often as solutions:
  "Fix X" rather than "X is a problem"), owner (optional in v1), classification
  (long-term / short-term), and the quarter (or week) context it belongs to.
- Source tracking: issues created from L10 segments (red scorecard cell, off-track
  rock, missed to-do) or manually. Store origin for context.
- **Resolution:** an issue is resolved by (a) being solved in an L10 (decisions
  captured as notes + resulting to-dos), (b) being marked "no longer an issue",
  or (c) expiring with its quarter (long-term issues unaddressed at quarter end
  get explicitly carried or dropped — never silently).

### IDS support (in the L10)

- Full IDS interaction lives in the meeting module (see level-10-meeting.md);
  this module owns the lists and provides the carry-in/carry-out behavior:
  - Pull any long-term issue into the current meeting's IDS queue.
  - Anything unsolved when the meeting concludes returns to the long-term list
    (standard EOS practice).
- Outside meetings: adding issues, moving between long/short-term, deleting,
  marking resolved.

### Lifecycle rules

- **Carry-forward:** unsolved short-term issues at week's end remain visible
  (aged); long-term issues at quarter's end prompt carry-or-drop.
- **Aging:** issues display age (weeks since added) — old issues are the team's
  shame list by design.
- No priorities, no assignee-required, no kanban. The only ordering is manual
  (drag-to-reorder is a later nicety; v1 uses creation order with a manual
  sort-order field).

## What it is not

- **Not a ticketing/helpdesk system.** No statuses beyond
  open / solved / dropped, no SLAs, no assignment workflows, no email intake.
- **Not a discussion thread.** Comments/threads are out; the discussion happens
  in the room (the meeting notes capture outcomes). One issue = one line + notes
  on resolution.
- **Not a task list.** Solving an issue generates **To-Dos** (a separate module);
  the issue itself does not get checkboxes.

## Data concepts

- `issues`: id, team_id, title, classification (long/short), quarter_id,
  origin (manual / from-rock / from-scorecard / from-todo / from-meeting),
  added_by, added_at, sort_order.
- `issue_resolutions`: issue_id, meeting_id (nullable), resolved_at, resolution
  note, outcome (solved / dropped).
- `issue_to_dos` is just `todos.issue_source_id` (see todos.md) — resolution
  notes reference the to-dos created.

## v1 vs later

- **v1:** CRUD, long/short-term classification, aging display, carry-forward
  prompts at quarter end, L10 integration (via meeting module), resolution notes.
- **Later:** drag-to-reorder, per-issue history view, solved-issues archive browse
  by quarter.

## Decided

1. **Views:** team list only — issues are team property in EOS; no per-person
   "my issues" view.
2. **Retention:** solved issues are kept forever (storage is trivial; revisit
   only if it ever matters).

---

*Historical open questions (both decided above):* per-person issue views;
solved-issue purge policy.