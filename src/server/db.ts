import { DatabaseSync } from 'node:sqlite'
import { drizzle, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import { migrate as proxyMigrate } from 'drizzle-orm/sqlite-proxy/migrator'
import { sql } from 'drizzle-orm'
import * as schema from './schema'
import { seedOwner } from './seed'
import { scheduleBackups } from './backup'
import path from 'node:path'
import fs from 'node:fs'

export type Db = SqliteRemoteDatabase<typeof schema>

const DB_FILE = process.env.OPENEOS_DB_PATH ?? path.resolve('data/openeos.db')
const MIGRATIONS_FOLDER = path.resolve('drizzle')

type Row = Record<string, unknown>

type ProxyCallback = (query: string, params: any[], method: 'run' | 'all' | 'values' | 'get') => Promise<{ rows: any[] | undefined }>

/**
 * Adapter between Drizzle's sqlite-proxy driver and Node's built-in
 * node:sqlite. Drizzle's proxy result mapping expects positional row arrays,
 * so we convert node:sqlite's object rows via the statement's column list.
 * For 'get' with no result we return `rows: undefined`, which Drizzle maps
 * to undefined (typed as any[] upstream, hence the cast).
 */
function makeCallback(sqlite: DatabaseSync): ProxyCallback {
  const callback = async (
    query: string,
    params: any[],
    method: 'run' | 'all' | 'values' | 'get',
  ): Promise<{ rows: unknown[] | undefined }> => {
    const stmt = sqlite.prepare(query)
    if (method === 'run') {
      stmt.run(...params)
      return { rows: [] }
    }
    // node:sqlite returns rows as objects; Drizzle's proxy mapping wants
    // positional arrays. Object.values preserves column order.
    if (method === 'get') {
      const obj = stmt.get(...params) as Row | undefined
      // Drizzle maps a missing 'get' result to undefined via rows: undefined
      // (the proxy type says any[], so we cast).
      return { rows: obj ? Object.values(obj) : undefined }
    }
    const objs = stmt.all(...params) as Row[]
    return { rows: objs.map(Object.values) }
  }
  // Surface the real SQLite error under Drizzle's "Failed query" wrapper.
  return (async (query, params, method) => {
    try {
      return await callback(query, params, method)
    } catch (err) {
      console.error(`[openeos db] query failed: ${query}`, err)
      throw err
    }
  }) as ProxyCallback
}

export function createDb(dbFile: string): { db: Db; sqlite: DatabaseSync } {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true })
  const sqlite = new DatabaseSync(dbFile)
  sqlite.exec('PRAGMA journal_mode = WAL')
  sqlite.exec('PRAGMA foreign_keys = ON')
  // Drizzle's declared proxy type doesn't include rows: undefined for missing
  // 'get' results, but its mapping handles it (mapGetResult returns undefined).
  const db = drizzle(makeCallback(sqlite) as unknown as Parameters<typeof drizzle>[0], { schema })
  return { db, sqlite }
}

/** Applies the SQL migrations in `drizzle/` to the given database. */
export async function migrateDb(db: Db): Promise<void> {
  await proxyMigrate(db, async (queries) => {
    for (const query of queries) {
      await db.run(sql.raw(query))
    }
  }, { migrationsFolder: MIGRATIONS_FOLDER })
}

let initPromise: Promise<Db> | null = null

/**
 * Server-side singleton database. Everything DB-related in the running app
 * goes through this (imported by server functions). Tests build their own
 * instance via tests/helpers.ts instead — the seam is these src/server modules.
 */
export function getDb(): Promise<Db> {
  // Init is serialized: concurrent SSR requests share one init promise so
  // migrations and seeding never race.
  if (!initPromise) {
    initPromise = (async () => {
      const created = createDb(DB_FILE)
      await migrateDb(created.db)
      await seedOwner(created.db)
      // Scheduled snapshot job; disabled during tests.
      if (!process.env.OPENEOS_DISABLE_BACKUP) {
        scheduleBackups(created.sqlite, DB_FILE)
      }
      return created.db
    })()
  }
  return initPromise
}