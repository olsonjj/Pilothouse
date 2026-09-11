# 14: Scorecard: weekly grid

**What to build:** The entry grid: metrics as rows, recent weeks as columns; one entry per metric per week (overwrite semantics); green/red derived automatically from target comparison direction; history stores the target in force that week.

**Blocked by:** 13: Scorecard: metric definitions, 03: Quarters & week utility.

**Status:** done (review pending)

- [x] Metric owner or admin enters one number per metric per week; re-entering overwrites
- [x] Traffic light derives from direction-aware comparison — never hand-set
- [x] Each entry stores `target_at_entry` so past weeks render correctly after re-targets
- [x] Week columns labeled via the shared week helper
- [x] Seam tests cover overwrite, direction logic, and re-target history
