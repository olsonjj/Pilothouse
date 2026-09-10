# OpenEOS

A single-company EOS (Entrepreneurial Operating System, per *Traction*) companion
app. TanStack Start (SSR + server functions), Tailwind CSS, SQLite via Drizzle
over Node's built-in `node:sqlite` (no native dependencies). Design docs live in
[`docs/`](docs/README.md); the build plan and tickets are in `docs/plans/`.

## Setup

```sh
pnpm install
pnpm dev          # dev server on http://localhost:3000
```

On first run the app creates `data/openeos.db`, applies migrations in `drizzle/`,
and seeds the owner admin account:

- email: `owner@openeos.local`
- password: `openeos-owner-dev` (dev-only default)

Override the password by setting `OPENEOS_OWNER_PASSWORD` before first run
(only matters while the DB has no users). **The default is for local
development only** — change it before exposing the app beyond localhost.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Dev server (http://localhost:3000) |
| `pnpm build` | Production build |
| `pnpm test` | Integration tests (vitest, temp SQLite per run) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm backup` | Write a manual SQLite snapshot (`VACUUM INTO`) |
| `pnpm exec drizzle-kit generate` | Regenerate migrations after schema changes |

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `OPENEOS_DB_PATH` | `data/openeos.db` | SQLite database file location |
| `OPENEOS_OWNER_PASSWORD` | dev-only default | Seed password for the owner account |
| `OPENEOS_BACKUP_INTERVAL_HOURS` | `12` | Interval between scheduled snapshots |
| `OPENEOS_DISABLE_BACKUP` | unset | Set to skip the scheduled snapshot job |

## Node version

The project is pinned to Node 24 LTS (`.volta` entry in `package.json`,
`engines >= 22.5` — `node:sqlite` is available unflagged from 22.5, stable in
24). Volta users get the pin automatically; on other managers use Node 24.

## Backups

Scheduled snapshots run on server start and on an interval (default 12h) using
SQLite's `VACUUM INTO`, writing timestamped files to `data/backups/`. Run
`pnpm backup` for a manual snapshot.

## Architecture notes

- **All database access lives behind server functions** (`src/functions/*.ts`,
  which wrap domain modules in `src/server/*.ts`). The client never touches the
  DB. This boundary also keeps a later cloud-DB migration contained.
- **Database driver:** Drizzle's `sqlite-proxy` adapter over Node's built-in
  `node:sqlite` (`src/server/db.ts`). The adapter maps object rows to the
  positional arrays Drizzle expects; `VACUUM INTO` backups and migrations work
  the same as with any SQLite driver. No native modules means no rebuilds and
  no ABI issues.
- **The test seam** is the `src/server` module boundary: tests exercise behavior
  through those modules against a real temp SQLite DB (see `tests/helpers.ts`).
  This is the pattern for all feature work — one seam, as high as possible.
  Runner: Node's built-in test runner (`node --test` + tsx loader).
- Password hashing is `node:crypto` scrypt (`salt:hash` hex), sessions are
  stored in SQLite and carried in an httpOnly cookie (`openeos_session`,
  30-day expiry).