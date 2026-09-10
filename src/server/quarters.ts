import type { Db } from './db'
import { quarters, type Quarter } from './schema'
import { getCurrentUser } from './auth'
import { quarterBounds, quarterKey, todayIso, weekStart, formatWeekLabel, type QuarterNumber } from './week'
import { and, asc, eq, gte, lte } from 'drizzle-orm'

/**
 * Quarters module (ticket 03): calendar-aligned EOS quarters, seeded for the
 * current + next calendar years, idempotent. Readable by every signed-in
 * user; nobody edits quarters (seed-only, immutable in schema).
 */

export type QuarterError = 'unauthenticated'

export type QuarterResult<T> = { ok: true; value: T } | { ok: false; error: QuarterError }

/**
 * Idempotently seed all quarters of the current and next calendar year.
 * Runs at DB init (like seedOwner) and is safe to call repeatedly — the
 * label UNIQUE constraint + DO NOTHING makes re-seeding a no-op.
 */
export async function ensureCurrentYearQuarters(db: Db, today = todayIso()): Promise<void> {
  const firstYear = quarterKey(today).year
  for (const year of [firstYear, firstYear + 1]) {
    for (const quarter of [1, 2, 3, 4] as const) {
      const bounds = quarterBounds(year, quarter)
      await db
        .insert(quarters)
        .values({ label: `${year} Q${quarter}`, ...bounds })
        .onConflictDoNothing()
    }
  }
}

/** The quarter containing `today` (or the passed date); undefined if none. */
export async function getCurrentQuarter(
  db: Db,
  today = todayIso(),
): Promise<Quarter | undefined> {
  return db
    .select()
    .from(quarters)
    .where(and(lte(quarters.startDate, today), gte(quarters.endDate, today)))
    .get()
}

export async function getQuarterById(db: Db, id: number): Promise<Quarter | undefined> {
  return db.select().from(quarters).where(eq(quarters.id, id)).get()
}

/** All seeded quarters, oldest first. Signed-in users only. */
export async function listQuarters(
  db: Db,
  token: string | undefined,
): Promise<QuarterResult<Quarter[]>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const rows = await db.select().from(quarters).orderBy(asc(quarters.startDate))
  return { ok: true, value: rows }
}

export type CurrentPeriod = {
  today: string
  /** The quarter containing today; null only if seeding hasn't covered the year. */
  quarter: Quarter | null
  /** Monday of the current week (the shared derived week key). */
  weekMonday: string
  /** "Week of Mar 3" display label. */
  weekLabel: string
}

/** Today + current quarter + current week, for the home header. */
export async function getCurrentPeriod(
  db: Db,
  token: string | undefined,
  today = todayIso(),
): Promise<QuarterResult<CurrentPeriod>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const quarter = (await getCurrentQuarter(db, today)) ?? null
  const weekMonday = weekStart(today)
  return {
    ok: true,
    value: { today, quarter: quarter ?? null, weekMonday, weekLabel: formatWeekLabel(weekMonday) },
  }
}

export { quarterBounds, quarterKey, weekStart, formatWeekLabel, type QuarterNumber }