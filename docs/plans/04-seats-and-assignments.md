# 04: Seats & assignments

**What to build:** The Accountability Chart's data: seats (name, description, ordered responsibilities, reporting line) and person-to-seat assignments with history. Small-company rules: a person can hold up to two seats; a seat has at most one active occupant.

**Blocked by:** 02: People & account linking.

**Status:** ready-for-agent

- [ ] Admin creates/edits seats with ordered responsibility bullets and a parent seat (or top seat)
- [ ] Assignments have start/end dates; current assignment = open-ended
- [ ] App-enforced caps: ≤2 active seats per person, one active occupant per seat (violation rejected)
- [ ] Assignment history survives seat moves (ended_at, not deletion)
- [ ] Members view; only admins edit
- [ ] Seam tests cover the caps, reassignment, and history
