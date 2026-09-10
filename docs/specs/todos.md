# To-Dos

## Purpose (EOS context)

To-Dos are the 7-day action items that come out of every meeting: small, specific,
assigned to one person, and due by the next meeting. EOS expects a ~90% completion
rate; to-do review is a fixed 5-minute L10 segment, and incomplete to-dos become
issues ("if it keeps not getting done, it's an issue").

## What it is

A lightweight action-item tracker tied to the meeting rhythm.

### To-Dos

- Fields: title (one line), assigned to (one person), created in/by (meeting),
  created date, **due date defaulting to 7 days out** (the next L10), status
  (open / done / dropped), and done date.
- To-dos are created from three places: inside the L10 (from the IDS segment or
  the Conclude recap), and from a quick-add anywhere in the app (personal or for
  others — creating a to-do for someone else is allowed; it shows up on their list
  immediately).
- **No descriptions beyond the title.** If it needs a paragraph, it's an issue,
  not a to-do.
- Recurring to-dos are out of scope (a weekly chore is a scorecard metric or a
  standing item in the meeting agenda, not a to-do).

### Weekly behavior

- **Completion view:** last week's to-dos shown done/not-done in the L10's To-Do
  segment; any not-done ones get a one-click "make this an issue" (Issues module).
- **Completion rate:** rolling 4-week completion percentage per person and per
  team, displayed on the to-dos screen. Just the number; no gamification.
- Overdue open to-dos are surfaced (red, sorted first) but not nagged automatically
  (no notifications in v1).
- Done to-dos are immutable records; dropping a to-do requires a reason (one line)
  so the completion rate stays honest.

## What it is not

- **Not a general task manager.** No projects, lists-within-lists, tags, boards,
  attachments, or subtasks. If it isn't a 7-day action item from (or feeding) a
  meeting, it belongs in the team's regular task tool.
- **Not a rock.** Rocks are quarterly objectives; to-dos are weekly actions.
  Explicitly no linking a to-do as "subtask of a rock" in v1.
- **No notifications/reminders in v1** — the L10 review is the enforcement
  mechanism (EOS-native).
- **No sharing beyond the team.** All to-dos are visible to all members (EOS is
  transparent; private to-dos are out of scope).

## Data concepts

- `todos`: id, title, assignee_person_id, created_by_person_id, team_id,
  source_meeting_id (nullable), issue_source_id (nullable), created_at, due_date,
  status (open/done/dropped), completed_at, drop_reason.
- Completion-rate queries derive from this table; no separate rollup tables.

## v1 vs later

- **v1:** quick-add, meeting creation, personal list view ("my to-dos" sorted by
  due), team view by week, completion-rate display, mark done/drop, L10
  integration (via meeting module).
- **Later:** dashboard widget, per-person history.

## Decided

1. **Default due date:** fixed 7 days from creation (no meeting scheduler in v1,
   so "next L10" isn't derivable yet).

---

*Historical open question (decided above):* fixed 7-day due date vs. next-L10
anchor.