import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Db } from './db'
import { users, sessions, people, type User } from './schema'
import { eq, lt, sql } from 'drizzle-orm'

export const SESSION_COOKIE = 'openeos_session'
export const SESSION_TTL_DAYS = 30

const SCRYPT_KEYLEN = 64

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, expectedHex] = stored.split(':')
  if (!salt || !expectedHex) return false
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN)
  const expected = Buffer.from(expectedHex, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/**
 * Public user shape handed to views and server modules. `personId` (null =
 * unlinked) is exposed since ticket 11: to-dos filter "my" rows by the linked
 * person and record creators by user id.
 */
export type PublicUser = Pick<User, 'id' | 'email' | 'name' | 'role' | 'personId'>

export type SignInResult =
  | { ok: true; sessionToken: string; user: PublicUser }
  | { ok: false; error: 'invalid_credentials' }

export type CurrentUserResult =
  | { ok: true; user: PublicUser }
  | { ok: false; error: 'unauthenticated' }

export type RoleCheckResult =
  | { ok: true; user: PublicUser }
  | { ok: false; error: 'unauthenticated' | 'forbidden' }

/**
 * Display name resolution (ticket 02 decision): when the account is linked to
 * a person, people.full_name is the source of truth; users.name is only a
 * fallback for not-yet-linked accounts (e.g. the seeded owner).
 */
function toPublic(user: User, personName?: string | null): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: personName ?? user.name,
    role: user.role,
    personId: user.personId,
  }
}

async function linkedPersonName(db: Db, user: User): Promise<string | null> {
  if (!user.personId) return null
  const row = await db
    .select({ fullName: people.fullName })
    .from(people)
    .where(eq(people.id, user.personId))
    .get()
  return row?.fullName ?? null
}

export async function createSession(
  db: Db,
  userId: number,
  now: Date = new Date(),
  ttlDays: number = SESSION_TTL_DAYS,
): Promise<string> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(
    now.getTime() + ttlDays * 24 * 60 * 60 * 1000,
  ).toISOString()
  await db
    .insert(sessions)
    .values({ token, userId, expiresAt, createdAt: now.toISOString() })
  return token
}

export async function signIn(db: Db, email: string, password: string): Promise<SignInResult> {
  const user = await db.select().from(users).where(eq(users.email, email)).get()
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return { ok: false, error: 'invalid_credentials' }
  }
  const sessionToken = await createSession(db, user.id)
  return { ok: true, sessionToken, user: toPublic(user, await linkedPersonName(db, user)) }
}

export async function getCurrentUser(db: Db, token: string | undefined): Promise<CurrentUserResult> {
  if (!token) return { ok: false, error: 'unauthenticated' }
  const row = await db
    .select({ user: users, personName: people.fullName, expiresAt: sessions.expiresAt })
    .from(sessions)
    // Join-aliasing constraint (see db.ts): only people columns whose names
    // don't collide with users/sessions columns may be selected unaliased
    // here. If you add more people columns to this select, SQL-alias them.
    .innerJoin(users, eq(sessions.userId, users.id))
    .leftJoin(people, eq(users.personId, people.id))
    .where(eq(sessions.token, token))
    .get()
  if (!row) return { ok: false, error: 'unauthenticated' }
  if (row.expiresAt <= new Date().toISOString()) {
    return { ok: false, error: 'unauthenticated' }
  }
  return { ok: true, user: toPublic(row.user, row.personName) }
}

/** Access-control gate for admin-only actions; server functions call this. */
export async function requireRole(
  db: Db,
  token: string | undefined,
  role: 'admin' | 'member',
): Promise<RoleCheckResult> {
  const current = await getCurrentUser(db, token)
  if (!current.ok) return current
  if (role === 'admin' && current.user.role !== 'admin') {
    return { ok: false, error: 'forbidden' }
  }
  return current
}

export async function signOut(db: Db, token: string | undefined): Promise<void> {
  if (!token) return
  await db.delete(sessions).where(eq(sessions.token, token))
}

/** Removes expired sessions; returns how many were removed. */
export async function cleanupExpiredSessions(db: Db, now: Date = new Date()): Promise<number> {
  const before = (await db.select({ n: sql<number>`count(*)` }).from(sessions).get())?.n ?? 0
  await db.delete(sessions).where(lt(sessions.expiresAt, now.toISOString()))
  const after = (await db.select({ n: sql<number>`count(*)` }).from(sessions).get())?.n ?? 0
  return Number(before) - Number(after)
}