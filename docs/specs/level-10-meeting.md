# Level 10 Meeting

## Purpose (EOS context)

The Level 10 (L10) is the weekly 90-minute leadership meeting with a fixed agenda.
It is the discipline engine of EOS: same time, same day, same agenda, with a timer.
The agenda, in minutes:

| Segment | Time | Content |
| --- | --- | --- |
| Segue | 5 | Good news, personal + business |
| Scorecard | 5 | Last week's metrics — off-track items become issues |
| Rock Review | 5 | Rock statuses — off-track rocks become issues |
| Customer/Employee Headlines | 5 | Short headlines; anything needing work becomes an issue |
| To-Do List | 5 | Review last week's to-dos (expect ~90% done); incomplete ones become issues |
| IDS | 60 | Solve the week's issues via Identify/Discuss/Solve |
| Conclude | 5 | Recap to-dos, cascading messages, rating 1–10 |

Anything that is not solved in 5 minutes becomes an issue on the Issues List; the
L10 does not rabbit-hole.

## What it is

A **live meeting companion**: a shared screen the team keeps open during the
meeting, with a visible countdown per segment, plus archiving.

### Pre-meeting

- Any member can start/schedule a meeting for the team. In v1: "start now" or
  "this week's meeting" — no calendar integration.
- The meeting opens with the current week's data pre-loaded: scorecard metrics with
  status, rocks with latest status, last week's to-dos with done/not-done.
- The **long-term issues list** (from the Issues module) is visible for pulling
  items into today's agenda.

### During the meeting

- **Shared live view:** all participants open the same meeting; updates from anyone
  (issue added, to-do created, status flipped) appear for everyone. Implementation:
  short polling (2–3s) on the meeting view; no websockets in v1.
- **Timer:** countdown per segment, driven by the facilitator (one person controls
  start/next). Visible big and central. Total-elapsed time also shown. The timer is
  advisory — a "go to next segment" button is always available; no hard lockouts.
- **Notes:** per-segment notes (plain text, one textarea per segment) typed live by
  anyone; last-write-wins per textarea with autosave. This is deliberately dumb —
  it is a shared notepad per segment, not a collaborative rich editor.
- **IDS:** the 60-minute block displays the meeting's issue list; each issue can be
  solved in-session (mark solved + capture the to-dos it produced) or dropped back
  to the long-term list. Creating a to-do from an issue assigns it to a member with
  a 7-day due date.
- **Rock/scorecard/to-do segments** are read-mostly: they display data from the
  other modules and offer "make this an issue" buttons that push an item into the
  meeting's issue list.

### Conclude

- Recap the new to-dos (everyone sees their own), capture any cascading messages,
  and record the 1–10 meeting rating per participant (stored, averaged, trended).
- **Archive:** on conclude, the meeting is frozen: notes, issues touched, to-dos
  created/completed, ratings, duration. The remaining unsolved issues auto-carry to
  the long-term list.

## What it is not

- **Not a video/audio tool.** No WebRTC, no recording.
- **Not a calendar/scheduling system** in v1 — no recurring-meeting scheduler,
  no invites; the weekly rhythm lives in people's calendars.
- **Not a notes wiki.** Archived meeting notes are frozen records, not editable
  pages afterwards (fix-typos-after-conclude is explicitly out; it's an archive).
- **Not a ticketing queue.** "Solving" an issue in-session means capturing decisions
  and to-dos; there is no lifecycle beyond open/carried/solved-today.
- **No private notes.** Everything on the shared view is visible to all members.

## Data concepts

- `meetings`: id, team_id, date, status (open/concluded), facilitator, started_at,
  concluded_at, agenda segment timeline (actual minutes per segment).
- `meeting_segments`: per segment, elapsed time and notes text.
- `meeting_issues`: issues attached to this meeting, state (in IDS queue / solved
  today / carried).
- `meeting_ratings`: meeting_id, person, score 1–10.
- Reuses: `todos` (created with source_meeting_id), `issues`, `rocks`,
  `scorecard_entries`.

## v1 vs later

- **v1:** start/conclude meeting, segment timer, per-segment notes, live shared
  view via polling, issue capture + to-do creation, ratings, archive + history list.
- **Later:** agenda customization (segment minutes), past-meeting recap emails,
  facilitator handoff indicator.

## Decided

1. **Realtime:** polling every 2–3s on the meeting view (KISS — no SSE/websockets
   until there's a real reason).
2. **Facilitator:** advisory — anyone can advance segments and edit; the
   facilitator is a label on the meeting.
3. **Cancelled meetings:** no cancel-state in v1; an open meeting can simply be
   deleted.

---

*Historical open questions (all decided above):* polling vs. SSE; facilitator
enforcement; cancelled-meeting state.