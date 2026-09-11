# 22: L10: live shared view & notes

**What to build:** The shared surface: all participants open the same meeting and see each other's updates within a few seconds (2–3s polling — no websockets), with one autosaving textarea of notes per segment (last-write-wins).

**Blocked by:** 21: L10: lifecycle, segments & timer.

**Status:** done (reviewer sign-off; constructible foreign-meeting pin + immediate post-rejection read added)

- [x] Meeting state (segment, elapsed time, notes, added items) visible to all participants
- [x] Polling refreshes the view every 2–3 seconds; no SSE/websockets
- [x] Per-segment notes autosave; concurrent edits resolve last-write-wins
- [x] Actual minutes per segment tracked for the archive
- [x] Seam tests verify state changes are visible through subsequent reads (polling model)
