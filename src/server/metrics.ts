import type { Db } from './db'
import { metrics, people, type Metric } from './schema'
import { requireRole, getCurrentUser } from './auth'
import { asc, eq } from 'drizzle-orm'

/**
 * Scorecard metric definitions (ticket 13). Admins manage; every signed-in
 * user can list (active only by default — the read view / future grid).
 * `includeInactive` (the admin panel) is ADMIN-GATED — the rule established
 * by the ticket-07 review. No week math here (ticket 14 owns entries).
 */

export type MetricDirection = 'gte' | 'lte'

export type MetricInput = {
  name: string
  ownerPersonId: number
  target: number
  direction?: MetricDirection
  unit?: string | null
  active?: boolean
}

export type MetricError =
  | 'unauthenticated'
  | 'forbidden'
  | 'name_required'
  | 'invalid_target'
  | 'invalid_direction'
  | 'not_found'

export type MetricResult<T> = { ok: true; value: T } | { ok: false; error: MetricError }

export type MetricWithOwner = Metric & { ownerName: string }

/** Targets are REAL: any finite number allowed, including 0 and negatives. */
function normalizeTarget(target: unknown): number | null {
  const n = typeof target === 'string' && target.trim() !== '' ? Number(target) : target
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function normalizeDirection(direction: string | null | undefined): MetricDirection | null {
  if (direction == null) return 'gte'
  return direction === 'gte' || direction === 'lte' ? direction : null
}

/**
 * Owner + name join for the list view. Join-aliasing constraint (db.ts): the
 * join selects people columns whose names don't collide with metrics columns
 * (owner_name), so a plain non-aliased pick is safe here; extend with SQL
 * aliases if more people columns are added.
 */
export async function listMetrics(
  db: Db,
  token: string | undefined,
  includeInactive = false,
): Promise<MetricResult<MetricWithOwner[]>> {
  const auth = includeInactive
    ? await requireRole(db, token, 'admin')
    : await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const rows = await db
    .select({
      id: metrics.id,
      name: metrics.name,
      ownerPersonId: metrics.ownerPersonId,
      target: metrics.target,
      direction: metrics.direction,
      unit: metrics.unit,
      active: metrics.active,
      createdAt: metrics.createdAt,
      updatedAt: metrics.updatedAt,
      ownerName: people.fullName,
    })
    .from(metrics)
    .innerJoin(people, eq(metrics.ownerPersonId, people.id))
    .orderBy(asc(metrics.name))
  return {
    ok: true,
    value: includeInactive ? rows : rows.filter((r) => r.active === 1),
  }
}

async function ownerExists(db: Db, personId: number): Promise<boolean> {
  const row = await db.select({ id: people.id }).from(people).where(eq(people.id, personId)).get()
  return row != null
}

function validateInput(
  input: MetricInput,
): { ok: true; name: string; target: number; direction: MetricDirection; unit: string | null; active: boolean } | { ok: false; error: MetricError } {
  const name = input.name?.trim() ?? ''
  if (!name) return { ok: false, error: 'name_required' }
  const target = normalizeTarget(input.target)
  if (target == null) return { ok: false, error: 'invalid_target' }
  const direction = normalizeDirection(input.direction)
  if (direction == null) return { ok: false, error: 'invalid_direction' }
  const unit = input.unit?.trim() ?? ''
  return {
    ok: true,
    name,
    target,
    direction,
    unit: unit === '' ? null : unit,
    active: input.active ?? true,
  }
}

export async function createMetric(
  db: Db,
  token: string | undefined,
  input: MetricInput,
): Promise<MetricResult<Metric>> {
  const auth = await requireRole(db, token, 'admin')
  if (!auth.ok) return auth
  const parsed = validateInput(input)
  if (!parsed.ok) return parsed
  if (!(await ownerExists(db, input.ownerPersonId))) return { ok: false, error: 'not_found' }
  const [metric] = await db
    .insert(metrics)
    .values({
      name: parsed.name,
      ownerPersonId: input.ownerPersonId,
      target: parsed.target,
      direction: parsed.direction,
      unit: parsed.unit,
      active: parsed.active ? 1 : 0,
    })
    .returning()
  return { ok: true, value: metric! }
}

export async function updateMetric(
  db: Db,
  token: string | undefined,
  metricId: number,
  input: MetricInput,
): Promise<MetricResult<Metric>> {
  const auth = await requireRole(db, token, 'admin')
  if (!auth.ok) return auth
  const existing = await db.select().from(metrics).where(eq(metrics.id, metricId)).get()
  if (!existing) return { ok: false, error: 'not_found' }
  const parsed = validateInput(input)
  if (!parsed.ok) return parsed
  if (!(await ownerExists(db, input.ownerPersonId))) return { ok: false, error: 'not_found' }
  const [metric] = await db
    .update(metrics)
    .set({
      name: parsed.name,
      ownerPersonId: input.ownerPersonId,
      target: parsed.target,
      direction: parsed.direction,
      unit: parsed.unit,
      active: parsed.active ? 1 : 0,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(metrics.id, metricId))
    .returning()
  return { ok: true, value: metric! }
}