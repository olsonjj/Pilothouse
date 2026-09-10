# 03: Quarters & week utility

**What to build:** The time spine for the whole app: EOS quarters seeded for the current and next calendar year, plus the shared Monday-start `weekStart()` helper that every weekly feature (rocks, scorecard, to-dos) will derive weeks from. Users can see the current quarter and week.

**Blocked by:** 01: Scaffold, auth & test seam.

**Status:** done (reviewer sign-off; see git log for the feat commit)

- [x] Quarters are calendar-aligned and labeled ("2025 Q1"), unique per label
- [x] Current + next year's quarters seeded automatically
- [x] `weekStart(date)` returns the Monday ISO date for any date; unit-tested on month/year/quarter boundaries (no DB needed — pure function)
- [x] Some visible surface shows the current quarter and week ("Week of Mar 3")
- [x] No week/dimension tables — weeks are derived, never stored
