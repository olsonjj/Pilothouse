# 20: Issues: provenance & quarter-end carry

**What to build:** Traceability and quarter hygiene: issues created from a red scorecard cell, an off-track rock, a missed to-do, or a meeting record their origin (origin + source reference), and unresolved long-term issues get an explicit carry-or-drop prompt at quarter end.

**Blocked by:** 16: Issues: core lists, 18: Rocks: weekly status, 14: Scorecard: weekly grid, 11: To-Dos: create & complete.

**Status:** done (reviewer sign-off; typecheck fix 5df7fd9 + UI nesting tidy applied)

- [x] Creating an issue from a rock/scorecard entry/to-do records origin and source ID
- [x] Origin is displayed on the issue
- [x] At quarter end, unresolved long-term issues prompt carry-or-drop; carry keeps the row and updates its quarter (never silent)
- [x] Short-term issues simply age in place
- [x] Seam tests cover each origin path and the quarter-end prompt logic
