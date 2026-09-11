import type { Db } from './db'
import { metricEntries, metrics, people, users, type Metric, type MetricEntry } from './schema'
import { requireRole, getCurrentUser } from './auth'
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { normalizeWeek, weekStart, formatWeekLabel } from './week'

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
  | 'invalid_window'
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
/* ------------------------------------------------------------------ */
/* Weekly entries (ticket 14)                                          */
/* ------------------------------------------------------------------ */

export type MetricEntryError =
  | MetricError
  | 'invalid_week'
  | 'invalid_actual'
  | 'metric_inactive'

export type MetricEntryResult<T> = { ok: true; value: T } | { ok: false; error: MetricEntryError }

export type GridCell = {
  entryId: number | null
  actual: number | null
  targetAtEntry: number | null
  pass: boolean | null
}

export type GridMetricRow = {
  id: number
  name: string
  ownerPersonId: number
  ownerName: string
  target: number
  direction: MetricDirection
  unit: string | null
  active: number
  cells: GridCell[]
}

export type GridWeek = { monday: string; label: string }

export type MetricGrid = { weeks: GridWeek[]; metrics: GridMetricRow[] }

/** Direction-aware traffic light, pinned by tests (boundary inclusive). */
function derivePass(direction: MetricDirection, actual: number, target: number): boolean {
  return direction === 'gte' ? actual >= target : actual <= target
}

function normalizeActual(actual: unknown): number | null {
  const n = typeof actual === 'string' && actual.trim() !== '' ? Number(actual) : actual
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/**
 * Enter (or overwrite) one metric's number for one week.
 *
 * Permissions: admin any metric; the metric's owner their own; other members
 * forbidden (specs/scorecard.md: "the owner (or any admin) enters").
 *
 * Re-entry overwrites `actual` AND re-captures `target_at_entry` from the
 * metric's CURRENT target: the entry's history basis is "the target in force
 * when the number was last written" (specs/scorecard.md: history rows keep the
 * target in force that week). A re-target therefore changes how the week's
 * pass/fail renders — decided, documented in data-model.md.
 *
 * TOCTOU note: target_at_entry is read-then-written without a transaction;
 * the node:sqlite proxy driver currently has no verified transaction wrapper.
 * Single-process SQLite makes a concurrent re-target race vanishingly unlikely
 * and self-healing (the next overwrite re-captures); documented, accepted.
 */
export async function setEntry(
  db: Db,
  token: string | undefined,
  metricId: number,
  week: string,
  actual: unknown,
): Promise<MetricEntryResult<MetricEntry>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const metric = await db.select().from(metrics).where(eq(metrics.id, metricId)).get()
  if (!metric) return { ok: false, error: 'not_found' }
  if (metric.active !== 1) return { ok: false, error: 'metric_inactive' }
  if (auth.user.role !== 'admin' && auth.user.personId !== metric.ownerPersonId) {
    return { ok: false, error: 'forbidden' }
  }
  const weekMonday = normalizeWeek(week)
  if (!weekMonday) return { ok: false, error: 'invalid_week' }
  const actualNumber = normalizeActual(actual)
  if (actualNumber == null) return { ok: false, error: 'invalid_actual' }

  const [entry] = await db
    .insert(metricEntries)
    .values({
      metricId,
      week: weekMonday,
      actual: actualNumber,
      targetAtEntry: metric.target,
      entryBy: auth.user.id,
    })
    .onConflictDoUpdate({
      target: [metricEntries.metricId, metricEntries.week],
      set: {
        actual: actualNumber,
        targetAtEntry: metric.target,
        entryBy: auth.user.id,
        updatedAt: new Date().toISOString(),
      },
    })
    .returning()
  return { ok: true, value: entry! }
}

/**
 * Per-metric entry history (includes retired metrics' entries — history is
 * readable forever). Signed-in users only; no extra permission (everyone
 * views everything except People Analyzer scores).
 */
export async function listEntriesForMetric(
  db: Db,
  token: string | undefined,
  metricId: number,
): Promise<MetricEntryResult<Array<MetricEntry & { entryByName: string }>>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const metric = await db.select({ id: metrics.id }).from(metrics).where(eq(metrics.id, metricId)).get()
  if (!metric) return { ok: false, error: 'not_found' }
  const rows = await db
    .select({
      id: sql<number>`"metric_entries"."id"`.as('e_id'),
      metricId: sql<number>`"metric_entries"."metric_id"`.as('e_metric_id'),
      week: sql<string>`"metric_entries"."week"`.as('e_week'),
      actual: sql<number>`"metric_entries"."actual"`.as('e_actual'),
      targetAtEntry: sql<number>`"metric_entries"."target_at_entry"`.as('e_target_at_entry'),
      entryBy: sql<number>`"metric_entries"."entry_by"`.as('e_entry_by'),
      createdAt: sql<string>`"metric_entries"."created_at"`.as('e_created_at'),
      updatedAt: sql<string>`"metric_entries"."updated_at"`.as('e_updated_at'),
      entryByName: sql<string>`"users"."name"`.as('u_name'),
    })
    .from(metricEntries)
    .innerJoin(users, eq(metricEntries.entryBy, users.id))
    .where(eq(metricEntries.metricId, metricId))
    .orderBy(desc(metricEntries.week), desc(metricEntries.id))
  return {
    ok: true,
    value: rows.map((r) => ({
      id: Number(r.id),
      metricId: Number(r.metricId),
      week: r.week,
      actual: r.actual,
      targetAtEntry: r.targetAtEntry,
      entryBy: Number(r.entryBy),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      entryByName: r.entryByName,
    })),
  }
}

/**
 * The weekly grid (ticket 14): active metrics as rows × the `weeks` most
 * recent week columns (default 8) ending with the week of `today`. Cells are
 * direction-aware pass/fail derived from `actual` vs `target_at_entry` —
 * never hand-set. Metrics with no entries get null cells. Red cells carry
 * entry id + metric id + week for ticket 23's issue push.
 */
export async function listEntriesForGrid(
  db: Db,
  token: string | undefined,
  weeks = 8,
  today = undefined as string | undefined,
): Promise<MetricEntryResult<{ weeks: GridWeek[]; metrics: GridMetricRow[] }>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth

  const todayIso = today ?? new Date().toISOString().slice(0, 10)
  const currentMonday = weekStart(todayIso)
  // Column order: oldest → newest.
  const weekKeys: string[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(`${currentMonday}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 7 * i)
    weekKeys.push(d.toISOString().slice(0, 10))
  }

  const metricRows = await listMetrics(db, token) // active only
  if (!metricRows.ok) return metricRows

  const entries =
    metricRows.value.length > 0
      ? await db
          .select()
          .from(metricEntries)
          .where(
            inArray(
              metricEntries.metricId,
              metricRows.value.map((m) => m.id),
            ),
          )
      : []
  const byKey = new Map(entries.map((e) => [`${e.metricId}:${e.week}`, e]))

  const gridMetrics: GridMetricRow[] = metricRows.value.map((m) => ({
    id: m.id,
    name: m.name,
    ownerPersonId: m.ownerPersonId,
    ownerName: m.ownerName,
    target: m.target,
    // Schema column is TEXT + CHECK (no enum param — keeps DDL simple); the
    // CHECK guarantees the domain union, so the cast is safe.
    direction: m.direction as MetricDirection,
    unit: m.unit,
    active: m.active,
    cells: weekKeys.map((w) => {
      const e = byKey.get(`${m.id}:${w}`)
      if (!e) return { entryId: null, actual: null, targetAtEntry: null, pass: null }
      return {
        entryId: e.id,
        actual: e.actual,
        targetAtEntry: e.targetAtEntry,
        pass: derivePass(m.direction as MetricDirection, e.actual, e.targetAtEntry),
      }
    }),
  }))

  return {
    ok: true,
    value: {
      weeks: weekKeys.map((w) => ({ monday: w, label: formatWeekLabel(w) })),
      metrics: gridMetrics,
    },
  }
}

// ---------------------------------------------------------------------------
// Ticket 15: per-metric trend series + trailing-quarter on-track rollups.
// Derived on every call from metric_entries — no rollup tables (data-model.md).
// ---------------------------------------------------------------------------

export type TrendPoint = {
  /** Monday ISO date of the week. */
  week: string
  label: string
  actual: number | null
  targetAtEntry: number | null
  pass: boolean | null
}

export type MetricTrend = {
  metric: { id: number; name: string; unit: string | null; active: number }
  /** Last `weeks` weeks, oldest → newest; nulls for weeks without entries. */
  points: TrendPoint[]
}

/**
 * Per-metric trend of the last `weeks` weeks (default 12) ending with the
 * week of `today`. Retired metrics still trend (history is readable forever
 * — same rule as listEntriesForMetric). Signed-in users only; everyone views
 * everything except People Analyzer scores.
 */
export async function metricTrend(
  db: Db,
  token: string | undefined,
  metricId: number,
  weeks = 12,
  today = undefined as string | undefined,
): Promise<MetricResult<MetricTrend>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) {
    return { ok: false, error: 'invalid_window' }
  }
  const metric = await db.select().from(metrics).where(eq(metrics.id, metricId)).get()
  if (!metric) return { ok: false, error: 'not_found' }

  const todayIso = today ?? new Date().toISOString().slice(0, 10)
  const currentMonday = weekStart(todayIso)
  const weekKeys: string[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(`${currentMonday}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 7 * i)
    weekKeys.push(d.toISOString().slice(0, 10))
  }

  const entries = await db.select().from(metricEntries).where(eq(metricEntries.metricId, metricId))
  const byWeek = new Map(entries.map((e) => [e.week, e]))

  const points: TrendPoint[] = weekKeys.map((w) => {
    const e = byWeek.get(w)
    if (!e) return { week: w, label: formatWeekLabel(w), actual: null, targetAtEntry: null, pass: null }
    return {
      week: w,
      label: formatWeekLabel(w),
      actual: e.actual,
      targetAtEntry: e.targetAtEntry,
      pass: derivePass(metric.direction as MetricDirection, e.actual, e.targetAtEntry),
    }
  })

  return {
    ok: true,
    value: {
      metric: { id: metric.id, name: metric.name, unit: metric.unit, active: metric.active },
      points,
    },
  }
}

export type RollupMetricRow = {
  metricId: number
  metricName: string
  ownerPersonId: number
  ownerName: string
  done: number
  counted: number
  /** done/counted × 100, one decimal; null when the metric has no window entries. */
  rate: number | null
}

export type RollupOwnerRow = {
  ownerPersonId: number
  ownerName: string
  done: number
  counted: number
  rate: number | null
}

export type OnTrackRollup = {
  /** Inclusive first Monday of the window. */
  windowStart: string
  /** Exclusive upper bound (the Monday AFTER the last counted week). */
  windowEnd: string
  metrics: RollupMetricRow[]
  owners: RollupOwnerRow[]
  team: { done: number; counted: number; rate: number | null }
}

/** Pure rate math: one decimal, null when nothing counted. Unit-tested directly. */
export function onTrackRate(done: number, counted: number): number | null {
  if (counted <= 0) return null
  return Math.round((done / counted) * 1000) / 10
}

/**
 * Trailing-quarter "weeks on-track %" per metric and per owner (specs/
 * scorecard.md). Window: the `weeks` (default 12) most recent weeks ENDING
 * WITH the current week — entries are usually written during/after their
 * week, so the current week's number counts (documented delta vs ticket 12's
 * fully-elapsed-weeks choice; different discipline, different window).
 *
 * Formula (documented in data-model.md): a metric's rate = pass-entries /
 * ALL window entries for that metric. Weeks WITHOUT entries are excluded
 * from both sides (a missing number is not a miss — the scorecard only
 * judges weeks that were actually reported); a metric with no window
 * entries gets a null rate, rendered "—".
 */
export async function onTrackRollup(
  db: Db,
  token: string | undefined,
  weeks = 12,
  today = undefined as string | undefined,
): Promise<MetricResult<OnTrackRollup>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) {
    return { ok: false, error: 'invalid_window' }
  }

  const todayIso = today ?? new Date().toISOString().slice(0, 10)
  const currentMonday = weekStart(todayIso)
  const weekKeys: string[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(`${currentMonday}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 7 * i)
    weekKeys.push(d.toISOString().slice(0, 10))
  }
  const windowStart = weekKeys[0]!
  const end = new Date(`${currentMonday}T12:00:00Z`)
  end.setUTCDate(end.getUTCDate() + 7)
  const windowEnd = end.toISOString().slice(0, 10)

  // All metrics (retired included — history is viewable); all window entries.
  const metricRows = await db.select().from(metrics).orderBy(asc(metrics.name))
  const ownerIds = [...new Set(metricRows.map((m) => m.ownerPersonId))]
  const ownerRows =
    ownerIds.length > 0
      ? await db
          .select({ id: people.id, fullName: people.fullName })
          .from(people)
          .where(inArray(people.id, ownerIds))
      : []
  const ownerNames = new Map(ownerRows.map((p) => [p.id, p.fullName]))

  const entries = await db
    .select()
    .from(metricEntries)
    .where(and(gte(metricEntries.week, windowStart), lt(metricEntries.week, windowEnd)))

  const metricMap = new Map(metricRows.map((m) => [m.id, m]))

  // Accumulators keyed by metric.
  const byMetric = new Map<number, { done: number; counted: number }>()
  for (const e of entries) {
    const acc = byMetric.get(e.metricId) ?? { done: 0, counted: 0 }
    const metric = metricMap.get(e.metricId)
    if (!metric) continue // entries whose metric row vanished (defensive)
    acc.counted += 1
    if (derivePass(metric.direction as MetricDirection, e.actual, e.targetAtEntry)) acc.done += 1
    byMetric.set(e.metricId, acc)
  }

  const metricRowsOut: RollupMetricRow[] = metricRows.map((m) => {
    const acc = byMetric.get(m.id) ?? { done: 0, counted: 0 }
    return {
      metricId: m.id,
      metricName: m.name,
      ownerPersonId: m.ownerPersonId,
      ownerName: ownerNames.get(m.ownerPersonId) ?? '—',
      done: acc.done,
      counted: acc.counted,
      rate: onTrackRate(acc.done, acc.counted),
    }
  })

  const byOwner = new Map<number, { done: number; counted: number }>()
  for (const row of metricRowsOut) {
    if (row.counted === 0) continue // empty metrics contribute nothing
    const acc = byOwner.get(row.ownerPersonId) ?? { done: 0, counted: 0 }
    acc.done += row.done
    acc.counted += row.counted
    byOwner.set(row.ownerPersonId, acc)
  }
  const owners: RollupOwnerRow[] = [...byOwner.entries()]
    .map(([ownerPersonId, acc]) => ({
      ownerPersonId,
      ownerName: ownerNames.get(ownerPersonId) ?? '—',
      done: acc.done,
      counted: acc.counted,
      rate: onTrackRate(acc.done, acc.counted),
    }))
    .sort((a, b) => a.ownerName.localeCompare(b.ownerName))

  const team = [...byOwner.values()].reduce(
    (acc, a) => ({ done: acc.done + a.done, counted: acc.counted + a.counted }),
    { done: 0, counted: 0 },
  )

  return {
    ok: true,
    value: {
      windowStart,
      windowEnd,
      metrics: metricRowsOut,
      owners,
      team: { done: team.done, counted: team.counted, rate: onTrackRate(team.done, team.counted) },
    },
  }
}
