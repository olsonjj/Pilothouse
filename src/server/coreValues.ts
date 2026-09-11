import type { Db } from './db'
import { coreValues, type CoreValue } from './schema'
import { requireRole, getCurrentUser } from './auth'
import { asc, eq, sql } from 'drizzle-orm'

/**
 * Core values module (ticket 07). First-class rows with STABLE IDs — the
 * Employee Assessment (ticket 10) scores against core_values.id, so rows are
 * never deleted: deactivation flips `active` to 0. Everyone signed in can
 * list; only admins create/edit/reorder.
 *
 * Documented decisions:
 * - Name uniqueness is CASE-INSENSITIVE (COLLATE NOCASE unique index) across
 *   ALL rows, active and inactive: a deactivated "Integrity" blocks a new
 *   "integrity" from resurrecting confusion.
 * - Default list is ACTIVE-only (the read view + future scorers consume it);
 *   the admin panel passes includeInactive to see and reactivate rows.
 * - Reorder takes the complete ordered ID list and assigns contiguous
 *   sort_order 0..n-1 (no gaps, no partial updates).
 */

export type CoreValueInput = {
  name: string
  description?: string | null
}

export type CoreValueError =
  | 'unauthenticated'
  | 'forbidden'
  | 'name_required'
  | 'name_taken'
  | 'not_found'
  | 'invalid_order'

export type CoreValueResult<T> = { ok: true; value: T } | { ok: false; error: CoreValueError }

function normalizeName(name: string | null | undefined): string | null {
  const trimmed = name?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

function normalizeDescription(description: string | null | undefined): string | null {
  const trimmed = description?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

/** App-level case-insensitive duplicate check (defense in depth with the NOCASE index). */
async function nameTaken(db: Db, name: string, excludeId?: number): Promise<boolean> {
  const rows = await db
    .select({ id: coreValues.id })
    .from(coreValues)
    .where(sql`${coreValues.name} = ${name} COLLATE NOCASE`)
  return rows.some((r) => r.id !== excludeId)
}

/**
 * Signed-in readable list. `includeInactive` is ADMIN-ONLY (the admin panel);
 * the default (read view, future scorers) returns active only, ordered by
 * sort_order — members requesting inactive rows get 'forbidden'.
 */
export async function listCoreValues(
  db: Db,
  token: string | undefined,
  includeInactive = false,
): Promise<CoreValueResult<CoreValue[]>> {
  const auth = includeInactive
    ? await requireRole(db, token, 'admin')
    : await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const rows = await db
    .select()
    .from(coreValues)
    .orderBy(asc(coreValues.sortOrder), asc(coreValues.id))
  return {
    ok: true,
    value: includeInactive ? rows : rows.filter((r) => r.active === 1),
  }
}

export async function createCoreValue(
  db: Db,
  token: string | undefined,
  input: CoreValueInput,
): Promise<CoreValueResult<CoreValue>> {
  const auth = await requireRole(db, token, 'admin')
  if (!auth.ok) return auth
  const name = normalizeName(input.name)
  if (!name) return { ok: false, error: 'name_required' }
  if (await nameTaken(db, name)) return { ok: false, error: 'name_taken' }
  // New values append to the end of the current active ordering.
  const existing = await db.select({ sortOrder: coreValues.sortOrder }).from(coreValues)
  const nextOrder = existing.length === 0 ? 0 : Math.max(...existing.map((r) => r.sortOrder)) + 1
  const [row] = await db
    .insert(coreValues)
    .values({ name, description: normalizeDescription(input.description), sortOrder: nextOrder })
    .returning()
  return { ok: true, value: row! }
}

export type CoreValueUpdate = {
  name?: string
  description?: string | null
  active?: boolean
}

/**
 * Admin edit: rename (keeps the row ID — that's the point of stable IDs),
 * re-describe, and activate/deactivate. Deactivation never deletes.
 */
export async function updateCoreValue(
  db: Db,
  token: string | undefined,
  id: number,
  input: CoreValueUpdate,
): Promise<CoreValueResult<CoreValue>> {
  const auth = await requireRole(db, token, 'admin')
  if (!auth.ok) return auth
  const existing = await db.select().from(coreValues).where(eq(coreValues.id, id)).get()
  if (!existing) return { ok: false, error: 'not_found' }

  let name = existing.name
  if (input.name !== undefined) {
    const normalized = normalizeName(input.name)
    if (!normalized) return { ok: false, error: 'name_required' }
    if (await nameTaken(db, normalized, id)) return { ok: false, error: 'name_taken' }
    name = normalized
  }
  const description =
    input.description !== undefined ? normalizeDescription(input.description) : existing.description
  const active = input.active !== undefined ? (input.active ? 1 : 0) : existing.active

  const [row] = await db
    .update(coreValues)
    .set({ name, description, active, updatedAt: nowIso() })
    .where(eq(coreValues.id, id))
    .returning()
  return { ok: true, value: row! }
}

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * Admin reorder: the complete ordered ID list becomes sort_order 0..n-1.
 * Duplicates or unknown IDs are rejected without touching anything.
 */
export async function reorderCoreValues(
  db: Db,
  token: string | undefined,
  orderedIds: number[],
): Promise<CoreValueResult<true>> {
  const auth = await requireRole(db, token, 'admin')
  if (!auth.ok) return auth
  const seen = new Set<number>()
  for (const id of orderedIds) {
    if (!Number.isInteger(id) || seen.has(id)) return { ok: false, error: 'invalid_order' }
    seen.add(id)
  }
  const all = await db.select({ id: coreValues.id }).from(coreValues)
  const known = new Set(all.map((r) => r.id))
  if (seen.size !== all.length || orderedIds.some((id) => !known.has(id))) {
    return { ok: false, error: 'invalid_order' }
  }
  const now = nowIso()
  for (const [index, id] of orderedIds.entries()) {
    await db
      .update(coreValues)
      .set({ sortOrder: index, updatedAt: now })
      .where(eq(coreValues.id, id))
  }
  return { ok: true, value: true }
}