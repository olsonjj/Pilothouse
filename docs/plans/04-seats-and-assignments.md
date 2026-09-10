# 04: Seats & assignments

**What to build:** The Accountability Chart's data: seats (name, description, ordered responsibilities, reporting line) and person-to-seat assignments with history. Small-company rules: a person can hold up to two seats; a seat has at most one active occupant.

**Blocked by:** 02: People & account linking.

**Status:** done (reviewer sign-off; see git log for the feat commit)

- [x] Admin creates/edits seats with ordered responsibility bullets and a parent seat (or top seat)
- [x] Assignments have start/end dates; current assignment = open-ended
- [x] App-enforced caps: ≤2 active seats per person, one active occupant per seat (violation rejected)
- [x] Assignment history survives seat moves (ended_at, not deletion)
- [x] Members view; only admins edit
- [x] Seam tests cover the caps, reassignment, and history
