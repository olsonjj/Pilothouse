# 19: Rocks: quarter-end & carry-over

**What to build:** Closing the quarter: admins mark each rock complete/incomplete, producing completion percentages per person and team (~80% EOS norm); unfinished rocks can be explicitly carried into the next quarter as new rocks referencing the original; past quarters become read-only history.

**Blocked by:** 18: Rocks: weekly status.

**Status:** done (reviewer sign-off; carry-source end-today boundary pin added)

- [x] Admin scores every rock in the ending quarter complete/incomplete
- [x] Completion % computed per person and per team for the quarter
- [x] Carry-over is explicit: new rock in the next quarter links to the original; nothing silently extends
- [x] Concluded quarters are read-only (writes rejected at the seam)
- [x] Seam tests cover scoring, percentages, carry-over, and past-quarter write denial
