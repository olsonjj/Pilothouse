/**
 * Pure date helpers for the app's time spine (ticket 03). Weeks are DERIVED,
 * never stored (data-model.md): a week is identified by the ISO date of its
 * Monday, produced here by `weekStart` and consumed by rock statuses,
 * scorecard entries, and to-dos.
 *
 * All math is UTC-based: dates are parsed at UTC noon so that timezone
 * offsets (local or DST) can never shift the day. This module must stay
 * dependency-free and side-effect-free.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Rejects malformed strings and impossible calendar dates ('2025-02-30'). */
export function assertValidDate(date: string): void {
  if (!DATE_RE.test(date)) {
    throw new Error(`invalid date (expected YYYY-MM-DD): ${date}`)
  }
  const [y, m, d] = date.split('-').map(Number)
  const probe = new Date(Date.UTC(y, m - 1, d))
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    throw new Error(`invalid calendar date: ${date}`)
  }
}

/** Parses 'YYYY-MM-DD' into a Date at UTC noon (TZ-drift-proof). */
export function parseDate(date: string): Date {
  assertValidDate(date)
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12))
}

/** Today's date as 'YYYY-MM-DD' (UTC). */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * The Monday of the week containing `date` (Monday-start weeks, decided).
 * Monday → itself; Sunday → six days back.
 */
export function weekStart(date: string): string {
  const d = parseDate(date)
  const offset = (d.getUTCDay() + 6) % 7 // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - offset)
  return d.toISOString().slice(0, 10)
}

/** "Week of Mar 3" display label for a Monday date. */
export function formatWeekLabel(monday: string): string {
  assertValidDate(monday)
  const formatted = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parseDate(monday))
  return `Week of ${formatted}`
}

export type QuarterNumber = 1 | 2 | 3 | 4

export function quarterKey(date: string): { year: number; quarter: QuarterNumber } {
  const [y, m] = date.split('-').map(Number)
  return { year: y, quarter: (Math.floor((m - 1) / 3) + 1) as QuarterNumber }
}

/** Calendar-aligned quarter bounds, inclusive ('2025 Q2' → Apr 1 – Jun 30). */
export function quarterBounds(
  year: number,
  quarter: QuarterNumber,
): { startDate: string; endDate: string } {
  const startMonth = { 1: 0, 2: 3, 3: 6, 4: 9 }[quarter]
  const start = new Date(Date.UTC(year, startMonth, 1, 12))
  const end = new Date(Date.UTC(year, startMonth + 3, 0, 12)) // day 0 = last day of previous month
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { startDate: iso(start), endDate: iso(end) }
}