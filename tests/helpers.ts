import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createDb, migrateDb, type Db } from '../src/server/db'
import * as schema from '../src/server/schema'
import { seedOwner, OWNER_EMAIL, DEFAULT_OWNER_PASSWORD } from '../src/server/seed'
import { ensureCurrentYearQuarters } from '../src/server/quarters'
import { hashPassword, signIn, type PublicUser } from '../src/server/auth'
import type { Role } from '../src/server/schema'

/**
 * The test seam helper: a fresh temp SQLite DB per call, migrated, with the
 * owner seeded. All ticket tests exercise behavior through src/server modules
 * against this real database.
 */
export async function createTestDb(): Promise<{ db: Db; sqlite: DatabaseSync; dir: string }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'boardroom-test-'))
  const dbFile = path.join(dir, 'test.db')
  const { db, sqlite } = createDb(dbFile)
  await migrateDb(db)
  await seedOwner(db)
  // Every ticket's tests can assume quarters exist (ticket 03+).
  await ensureCurrentYearQuarters(db)
  return { db, sqlite, dir }
}

export async function signedInUser(
  db: Db,
  role: Role = 'admin',
  email = `user-${crypto.randomUUID()}@example.com`,
): Promise<{ token: string; user: PublicUser }> {
  const password = `pw-${crypto.randomUUID()}`
  await db
    .insert(schema.users)
    .values({ email, passwordHash: hashPassword(password), name: 'Test User', role })
  const result = await signIn(db, email, password)
  if (!result.ok) throw new Error('sign-in fixture failed')
  return { token: result.sessionToken, user: result.user }
}

export const owner = {
  email: OWNER_EMAIL,
  password: DEFAULT_OWNER_PASSWORD,
} as const