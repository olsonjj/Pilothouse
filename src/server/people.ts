import type { Db } from './db'
import { people, users, type Person } from './schema'
import { requireRole, getCurrentUser } from './auth'
import { and, eq, isNull, ne, sql } from 'drizzle-orm'

/**
 * People domain module (ticket 02). Admins create/edit people and manage the
 * person↔user login link (which lives on users.person_id — see data-model.md).
 * Members and every signed-in user can list/view only. Display names resolve
 * through people.full_name once linked (see auth.ts).
 */

export type PersonInput = {
  fullName: string
  email?: string | null
  startDate?: string | null
}

export type PersonWithAccount = Person & {
  linkedUser: { id: number; email: string } | null
}

export type PersonError =
  | 'unauthenticated'
  | 'forbidden'
  | 'name_required'
  | 'email_taken'
  | 'invalid_date'
  | 'not_found'
  | 'already_linked'

export type PersonResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PersonError }

function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function normalizeDate(date: string | null | undefined): string | null | 'invalid' {
  const trimmed = date?.trim() ?? ''
  if (trimmed === '') return null
  return DATE_RE.test(trimmed) ? trimmed : 'invalid'
}

async function emailTaken(
  db: Db,
  email: string | null,
  excludePersonId?: number,
): Promise<boolean> {
  if (!email) return false
  const row = await db
    .select({ id: people.id })
    .from(people)
    .where(
      and(
        eq(people.email, email),
        excludePersonId ? ne(people.id, excludePersonId) : undefined,
      ),
    )
    .get()
  return row != null
}

function validateInput(input: PersonInput):
  | { ok: true; fullName: string; email: string | null; startDate: string | null }
  | { ok: false; error: 'name_required' | 'invalid_date' } {
  const fullName = input.fullName?.trim() ?? ''
  if (!fullName) return { ok: false, error: 'name_required' }
  const startDate = normalizeDate(input.startDate)
  if (startDate === 'invalid') return { ok: false, error: 'invalid_date' }
  return {
    ok: true,
    fullName,
    email: normalizeEmail(input.email),
    startDate: startDate as string | null,
  }
}

export async function createPerson(
  db: Db,
  token: string | undefined,
  input: PersonInput,
): Promise<PersonResult<Person>> {
  const auth = await requireRole(db, token, 'admin')
  if (!auth.ok) return auth
  const parsed = validateInput(input)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  if (await emailTaken(db, parsed.email)) return { ok: false, error: 'email_taken' }
  const [person] = await db
    .insert(people)
    .values({
      fullName: parsed.fullName,
      email: parsed.email,
      startDate: parsed.startDate,
    })
    .returning()
  return { ok: true, value: person! }
}

export async function updatePerson(
  db: Db,
  token: string | undefined,
  personId: number,
  input: PersonInput,
): Promise<PersonResult<Person>> {
  const auth = await requireRole(db, token, 'admin')
  if (!auth.ok) return auth
  const existing = await db.select().from(people).where(eq(people.id, personId)).get()
  if (!existing) return { ok: false, error: 'not_found' }
  const parsed = validateInput(input)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  if (await emailTaken(db, parsed.email, personId)) return { ok: false, error: 'email_taken' }
  const [person] = await db
    .update(people)
    .set({
      fullName: parsed.fullName,
      email: parsed.email,
      startDate: parsed.startDate,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(people.id, personId))
    .returning()
  return { ok: true, value: person! }
}

/** Everyone signed in can view the people list (linked-account info included). */
export async function listPeople(
  db: Db,
  token: string | undefined,
): Promise<PersonResult<PersonWithAccount[]>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  // Join columns must be SQL-aliased uniquely: the node:sqlite proxy driver
  // collapses duplicate column names in object rows, which would misalign
  // Drizzle's positional mapping (see db.ts comment).
  const rows = await db
    .select({
      id: sql<number>`"people"."id"`.as('p_id'),
      fullName: sql<string>`"people"."full_name"`.as('p_full_name'),
      email: sql<string | null>`"people"."email"`.as('p_email'),
      startDate: sql<string | null>`"people"."start_date"`.as('p_start_date'),
      createdAt: sql<string>`"people"."created_at"`.as('p_created_at'),
      updatedAt: sql<string>`"people"."updated_at"`.as('p_updated_at'),
      linkedUserId: sql<number | null>`"users"."id"`.as('u_id'),
      linkedUserEmail: sql<string | null>`"users"."email"`.as('u_email'),
    })
    .from(people)
    .leftJoin(users, eq(users.personId, people.id))
    .orderBy(people.fullName)
  return {
    ok: true,
    value: rows.map((r) => ({
      id: Number(r.id),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      fullName: r.fullName,
      email: r.email,
      startDate: r.startDate,
      linkedUser:
        r.linkedUserId != null ? { id: Number(r.linkedUserId), email: r.linkedUserEmail ?? '' } : null,
    })),
  }
}

/**
 * Admin-only: user accounts not yet linked to a person (candidates for the
 * link select in the UI).
 */
export async function listUnlinkedUsers(
  db: Db,
  token: string | undefined,
): Promise<PersonResult<Array<{ id: number; email: string; name: string }>>> {
  const auth = await requireRole(db, token, 'admin')
  if (!auth.ok) return auth
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(isNull(users.personId))
    .orderBy(users.email)
  return { ok: true, value: rows }
}

export async function linkUserToPerson(
  db: Db,
  token: string | undefined,
  userId: number,
  personId: number,
): Promise<PersonResult<true>> {
  const auth = await requireRole(db, token, 'admin')
  if (!auth.ok) return auth
  const person = await db.select().from(people).where(eq(people.id, personId)).get()
  if (!person) return { ok: false, error: 'not_found' }
  const user = await db.select().from(users).where(eq(users.id, userId)).get()
  if (!user) return { ok: false, error: 'not_found' }
  // One-to-one: the user must not already belong to a different person, and
  // no other user may already hold this person.
  if (user.personId != null && user.personId !== personId) {
    return { ok: false, error: 'already_linked' }
  }
  const other = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.personId, personId), ne(users.id, userId)))
    .get()
  if (other) return { ok: false, error: 'already_linked' }
  await db
    .update(users)
    .set({ personId, updatedAt: new Date().toISOString() })
    .where(eq(users.id, userId))
  return { ok: true, value: true }
}

export async function unlinkUser(
  db: Db,
  token: string | undefined,
  userId: number,
): Promise<PersonResult<true>> {
  const auth = await requireRole(db, token, 'admin')
  if (!auth.ok) return auth
  const user = await db.select().from(users).where(eq(users.id, userId)).get()
  if (!user) return { ok: false, error: 'not_found' }
  await db
    .update(users)
    .set({ personId: null, updatedAt: new Date().toISOString() })
    .where(eq(users.id, userId))
  return { ok: true, value: true }
}