import type { Db } from './db'
import { users, sessions, people, type User } from './schema'
import { hashPassword, requireRole } from './auth'
import { eq, asc, sql } from 'drizzle-orm'

/**
 * User management (ticket 26): admins create login accounts, reset passwords,
 * and set roles. Deliberately minimal, per the ticket:
 * - No delete path: users are referenced by sessions/issues/to-dos/ratings
 *   and are permanent like every other record in the app.
 * - No self-service password change: admins set/reset passwords (local,
 *   trusted-team app). A reset deletes ALL of that user's sessions, forcing
 *   re-login everywhere.
 * - Role guard: an admin cannot change their OWN role — prevents the
 *   last-admin lockout (the seeded owner is the only admin today).
 * - Email matching is CASE-SENSITIVE, matching the `users.email` unique
 *   index (plain UNIQUE, no COLLATE NOCASE — documented; differs from the
 *   people-email NOCASE decision only in that it's the index's own behavior).
 * - No auto-session on create: the new user signs in themselves.
 */

export const MIN_PASSWORD_LENGTH = 8

export type UserManagementError =
  | 'unauthenticated'
  | 'forbidden'
  | 'email_required'
  | 'email_invalid'
  | 'email_taken'
  | 'name_required'
  | 'password_required'
  | 'password_too_short'
  | 'invalid_role'
  | 'not_found'
  | 'self_role_change'

export type UserMgmtResult<T> = { ok: true; value: T } | { ok: false; error: UserManagementError }

export type NewUserInput = {
  email: string
  name: string
  password: string
  role: 'admin' | 'member'
}

export type ManagedUser = {
  id: number
  email: string
  name: string
  role: 'admin' | 'member'
  personId: number | null
  /** Display name of the linked person, if any (join, aliased). */
  personName: string | null
  createdAt: string
}

function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

/** Loose validity: must contain @ — real validation is out of scope (no email flows). */
function emailPlausible(email: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(email)
}

function validatePassword(password: string | null | undefined): 'password_required' | 'password_too_short' | null {
  if (!password || password.length === 0) return 'password_required'
  if (password.length < MIN_PASSWORD_LENGTH) return 'password_too_short'
  return null
}

async function emailTaken(db: Db, email: string): Promise<boolean> {
  // Case-sensitive on purpose: matches the users.email UNIQUE index exactly.
  const row = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()
  return row != null
}

/** Admin creates a login. No auto-session; the new user signs in themselves. */
export async function createUser(
  db: Db,
  token: string | undefined,
  input: NewUserInput,
): Promise<UserMgmtResult<User>> {
  const auth = await requireRole(db, token, 'admin')
  if (!auth.ok) return auth

  const email = normalizeEmail(input.email)
  if (!email) return { ok: false, error: 'email_required' }
  if (!emailPlausible(email)) return { ok: false, error: 'email_invalid' }
  if (await emailTaken(db, email)) return { ok: false, error: 'email_taken' }

  const name = input.name?.trim() ?? ''
  if (!name) return { ok: false, error: 'name_required' }

  const pwError = validatePassword(input.password)
  if (pwError) return { ok: false, error: pwError }

  if (input.role !== 'admin' && input.role !== 'member') {
    return { ok: false, error: 'invalid_role' }
  }

  const [user] = await db
    .insert(users)
    .values({
      email,
      name,
      passwordHash: hashPassword(input.password),
      role: input.role,
      updatedAt: new Date().toISOString(),
    })
    .returning()
  return { ok: true, value: user! }
}

/**
 * Admin resets a user's password. Deletes ALL of that user's sessions so
 * every signed-in device is forced back to the sign-in page.
 */
export async function resetPassword(
  db: Db,
  token: string | undefined,
  userId: number,
  newPassword: string,
): Promise<UserMgmtResult<true>> {
  const auth = await requireRole(db, token, 'admin')
  if (!auth.ok) return auth

  const pwError = validatePassword(newPassword)
  if (pwError) return { ok: false, error: pwError }

  const user = await db.select().from(users).where(eq(users.id, userId)).get()
  if (!user) return { ok: false, error: 'not_found' }

  await db
    .update(users)
    .set({ passwordHash: hashPassword(newPassword), updatedAt: new Date().toISOString() })
    .where(eq(users.id, userId))
  await db.delete(sessions).where(eq(sessions.userId, userId))
  return { ok: true, value: true }
}

/**
 * Admin flips a role. Guard: an admin cannot change their OWN role (the
 * caller's own account) — prevents demoting/removing the last admin.
 */
export async function setRole(
  db: Db,
  token: string | undefined,
  userId: number,
  role: 'admin' | 'member',
): Promise<UserMgmtResult<true>> {
  const auth = await requireRole(db, token, 'admin')
  if (!auth.ok) return auth
  if (auth.user.id === userId) return { ok: false, error: 'self_role_change' }
  if (role !== 'admin' && role !== 'member') return { ok: false, error: 'invalid_role' }

  const user = await db.select().from(users).where(eq(users.id, userId)).get()
  if (!user) return { ok: false, error: 'not_found' }

  await db
    .update(users)
    .set({ role, updatedAt: new Date().toISOString() })
    .where(eq(users.id, userId))
  return { ok: true, value: true }
}

/**
 * Admin-only user list with linked-person info. Join columns are SQL-aliased
 * uniquely (node:sqlite proxy constraint — see db.ts).
 */
export async function listUsers(
  db: Db,
  token: string | undefined,
): Promise<UserMgmtResult<ManagedUser[]>> {
  const auth = await requireRole(db, token, 'admin')
  if (!auth.ok) return auth
  const rows = await db
    .select({
      id: sql<number>`"users"."id"`.as('u_id'),
      email: sql<string>`"users"."email"`.as('u_email'),
      name: sql<string>`"users"."name"`.as('u_name'),
      role: sql<string>`"users"."role"`.as('u_role'),
      personId: sql<number | null>`"users"."person_id"`.as('u_person_id'),
      personName: sql<string | null>`"people"."full_name"`.as('p_full_name'),
      createdAt: sql<string>`"users"."created_at"`.as('u_created_at'),
    })
    .from(users)
    .leftJoin(people, eq(users.personId, people.id))
    .orderBy(asc(users.email))
  return {
    ok: true,
    value: rows.map((r) => ({
      id: Number(r.id),
      email: r.email,
      name: r.name,
      role: r.role as 'admin' | 'member',
      personId: r.personId == null ? null : Number(r.personId),
      personName: r.personName,
      createdAt: r.createdAt,
    })),
  }
}