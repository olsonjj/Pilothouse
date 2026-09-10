# 01: Scaffold, auth & test seam

**What to build:** A working OpenEOS app anyone can sign into: TanStack Start + Tailwind + SQLite via Drizzle, email/password auth with sessions, admin/member roles, a seeded owner account, a scheduled SQLite snapshot job, and the server-function test seam established so every later ticket follows it.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Sign in/out works; sessions persist across visits; bad credentials rejected
- [ ] Roles (`admin`/`member`) enforced in server functions, not the UI only
- [ ] Owner admin account seeded on first run
- [ ] Scheduled job writes a SQLite backup snapshot file
- [ ] Test suite exercises behavior through server functions against a temp SQLite DB (the single seam), runnable locally
- [ ] All DB access lives behind server functions; no client DB access
