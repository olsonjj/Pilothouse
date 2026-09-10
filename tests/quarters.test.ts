import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ensureCurrentYearQuarters,
  getCurrentQuarter,
  getQuarterById,
  listQuarters,
  getCurrentPeriod,
} from '../src/server/quarters'
import { weekStart } from '../src/server/week'
import { quarters } from '../src/server/schema'
import { createTestDb, signedInUser } from './helpers'

/** Calendar-safe +N days helper for test fixtures ('YYYY-MM-DD' in, out). */
function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Seam tests for the quarters module (ticket 03): behavior through
 * src/server/quarters.ts against a real temp SQLite DB. Fixed dates only —
 * never Date.now() — so runs stay deterministic across real year rolls.
 */
describe('quarters seeding (seam)', () => {
  it('seeds 8 quarters (current + next year) and is idempotent', async () => {
    const { db } = await createTestDb()
    // helpers.ts already seeded once at createTestDb.
    assert.equal((await db.select().from(quarters)).length, 8)
    // Re-seed: a no-op.
    await ensureCurrentYearQuarters(db)
    assert.equal((await db.select().from(quarters)).length, 8)
  })

  it('labels are unique and calendar-aligned', async () => {
    const { db } = await createTestDb()
    const rows = await db.select().from(quarters)
    const labels = rows.map((r) => r.label)
    assert.equal(new Set(labels).size, labels.length)
    for (const row of rows) {
      const start = new Date(row.startDate + 'T12:00:00Z')
      assert.equal(start.getUTCDate(), 1, `${row.label} must start on day 1`)
      // End date is the last day of the quarter: start month + 3 - 1 day.
      const expectedEnd = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 0, 12),
      )
      assert.equal(
        row.endDate,
        expectedEnd.toISOString().slice(0, 10),
        `${row.label} end date`,
      )
    }
  })

  it('seeds forward across a year boundary (deterministic, explicit today)', async () => {
    const { db } = await createTestDb()
    const earliestYear = Number(
      (await db.select().from(quarters).orderBy(quarters.startDate)).map((r) => r.startDate)[0].slice(0, 4),
    )
    // A January run of the following year extends the seed by one year.
    await ensureCurrentYearQuarters(db, `${earliestYear + 1}-01-02`)
    const labels = (await db.select().from(quarters)).map((r) => r.label)
    for (const year of [earliestYear, earliestYear + 1, earliestYear + 2]) {
      for (const q of [1, 2, 3, 4]) {
        assert.ok(labels.includes(`${year} Q${q}`), `missing ${year} Q${q}`)
      }
    }
    assert.equal(labels.length, 12)
  })
})

describe('getCurrentQuarter / getQuarterById (seam)', () => {
  it('finds the containing quarter, inclusive of boundary dates', async () => {
    const { db } = await createTestDb()
    const all = await db.select().from(quarters)
    const sorted = all.sort((a, b) => a.startDate.localeCompare(b.startDate))
    const first = sorted[0]
    const second = sorted[1]

    const midFirst = await getCurrentQuarter(db, addDays(first.startDate, 15))
    assert.ok(midFirst, 'mid-quarter must land in a quarter')
    assert.equal(midFirst.label, first.label)

    // Boundary: the last day of Q1 belongs to Q1; the next day belongs to Q2.
    const q1End = await getCurrentQuarter(db, first.endDate)
    assert.ok(q1End, 'last day of Q1 belongs to Q1')
    assert.equal(q1End.endDate, first.endDate)

    const q2Start = await getCurrentQuarter(db, second.startDate)
    assert.ok(q2Start, 'first day of Q2 belongs to Q2')
    assert.notEqual(q2Start.id, q1End.id)
  })

  it('returns undefined outside any seeded quarter', async () => {
    const { db } = await createTestDb()
    // helpers seeds the real current + next year; 2001 is outside that range
    // in any run year >= 2001's next year. To stay deterministic regardless of
    // the real clock, probe the year before the earliest seeded quarter.
    const all = await db.select().from(quarters)
    const earliest = all.map((r) => r.startDate).sort()[0]
    const before = `${Number(earliest.slice(0, 4)) - 1}-06-15`
    assert.equal(await getCurrentQuarter(db, before), undefined)
  })

  it('getQuarterById round-trips; unknown id is undefined', async () => {
    const { db } = await createTestDb()
    const anyQuarter = (await db.select().from(quarters).orderBy(quarters.startDate))[0]
    assert.ok(anyQuarter)
    const fetched = await getQuarterById(db, anyQuarter.id)
    assert.ok(fetched)
    assert.equal(fetched.label, anyQuarter.label)
    assert.equal(await getQuarterById(db, 99999), undefined)
  })
})

describe('listQuarters / getCurrentPeriod (seam)', () => {
  it('lists all quarters oldest-first for any signed-in user', async () => {
    const { db } = await createTestDb()
    const member = await signedInUser(db, 'member')
    const result = await listQuarters(db, member.token)
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.value.length, 8)
      const dates = result.value.map((q) => q.startDate)
      const sorted = [...dates].sort()
      assert.deepEqual(dates, sorted)
    }
  })

  it('rejects unauthenticated viewers', async () => {
    const { db } = await createTestDb()
    assert.deepEqual(await listQuarters(db, undefined), { ok: false, error: 'unauthenticated' })
    assert.deepEqual(await getCurrentPeriod(db, undefined), { ok: false, error: 'unauthenticated' })
  })

  it('current period reports quarter + derived week label', async () => {
    const { db } = await createTestDb()
    const member = await signedInUser(db, 'member')
    const seeded = await db.select().from(quarters).orderBy(quarters.startDate)
    const today = addDays(seeded[1].startDate, 20) // mid-Q2 of the earliest seeded year
    const result = await getCurrentPeriod(db, member.token, today)
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.value.today, today)
      assert.ok(result.value.quarter, 'today should fall inside a seeded quarter')
      assert.equal(result.value.weekMonday, weekStart(today))
      assert.match(result.value.weekLabel, /^Week of [A-Z][a-z]{2} \d{1,2}$/)
    }
  })
})