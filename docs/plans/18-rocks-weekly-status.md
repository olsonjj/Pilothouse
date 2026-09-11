# 18: Rocks: weekly status

**What to build:** The weekly heartbeat: rock owners mark each rock on-track or off-track once a week (one row per rock per week, overwrite), or "measuring" with the week's actual number against a target. Rocks off-track two consecutive weeks are highlighted.

**Blocked by:** 17: Rocks: create & manage.

**Status:** done (review pending)

- [x] Owner updates own rock status weekly; admins can update any; strict overwrite per week
- [x] Statuses: on_track / off_track / measuring (measuring requires a target and captures `actual`)
- [x] Optional one-line comment per status
- [x] 2-consecutive-off-track rocks visually highlighted; status history queryable
- [x] Seam tests cover overwrite semantics, measuring validation, and the highlight query
