# 01: Scaffold, auth & test seam

**What to build:** A working OpenEOS app anyone can sign into: TanStack Start + Tailwind + SQLite via Drizzle, email/password auth with sessions, admin/member roles, a seeded owner account, a scheduled SQLite snapshot job, and the server-function test seam established so every later ticket follows it.

**Blocked by:** None (can start immediately).

**Status:** done (reviewer sign-off; see git log for the feat commit)

- [x] Sign in/out works; sessions persist across visits; bad credentials rejected
- [x] Roles (`admin`/`member`) enforced in server functions, not the UI only
- [x] Owner admin account seeded on first run
- [x] Scheduled job writes a SQLite backup snapshot file
- [x] Test suite exercises behavior through server functions against a temp SQLite DB (the single seam), runnable locally
- [x] All DB access lives behind server functions; no client DB access

## Implementation notes (completed 2026-09-10)

- DB driver: Node's built-in `node:sqlite` via Drizzle's `sqlite-proxy` adapter
  instead of better-sqlite3. better-sqlite3's native binding segfaults inside
  vite's dev module runner on this machine (verified: plain node, plain forks,
  workers, and tsx all fine; vite-node/vitest/vite dev all crash; other napi
  modules like @parcel/watcher load fine under the runner). node:sqlite is
  built into the binary — no dlopen, no crash — and keeps Drizzle + SQLite.
- Test runner: Node's built-in `node --test` with a tsx loader instead of
  vitest (vitest's worker processes crashed identically on this machine).
- Runtime pinned to Node 24 LTS (volta in package.json; pnpm-spawned processes
  otherwise resolved Node 22.13.1, which lacks some node:sqlite APIs).
- HTTP-layer behaviors verified live: unauthenticated / redirects (307) to
  /signin, sign-in page renders, session cookie renders the signed-in home,
  bad cookie rejected, `pnpm backup` writes snapshots.
