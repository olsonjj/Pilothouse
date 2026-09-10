import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  weekStart,
  formatWeekLabel,
  quarterBounds,
  quarterKey,
  parseDate,
  assertValidDate,
} from '../src/server/week'

/**
 * Direct unit tests for the pure week/quarter helpers — the documented
 * exception to the server-function seam rule (pure date math where DB-mediated
 * fixtures would be disproportionate). All inputs are fixed dates, never
 * Date.now().
 */
describe('weekStart (pure)', () => {
  it('returns the same Monday for a Monday', () => {
    assert.equal(weekStart('2025-09-08'), '2025-09-08')
  })

  it('maps midweek days back to their Monday', () => {
    assert.equal(weekStart('2025-09-10'), '2025-09-08') // Wednesday
    assert.equal(weekStart('2025-09-13'), '2025-09-08') // Saturday
  })

  it('rolls Sunday back six days (Monday-start weeks)', () => {
    assert.equal(weekStart('2025-09-14'), '2025-09-08')
  })

  it('crosses the year boundary into the previous year', () => {
    // 2025-01-01 is a Wednesday.
    assert.equal(weekStart('2025-01-01'), '2024-12-30')
    // 2026-01-01 is a Thursday.
    assert.equal(weekStart('2026-01-01'), '2025-12-29')
    assert.equal(weekStart('2025-12-31'), '2025-12-29')
  })

  it('handles leap-year February correctly', () => {
    // 2024-02-29 is a Thursday.
    assert.equal(weekStart('2024-02-29'), '2024-02-26')
  })

  it('crosses month boundaries backwards', () => {
    // 2025-03-01 is a Saturday.
    assert.equal(weekStart('2025-03-01'), '2025-02-24')
  })

  it('crosses quarter boundaries (Q1/Q2, Q3/Q4)', () => {
    // 2025-03-31 is a Monday; 2025-04-01 a Tuesday in the same week.
    assert.equal(weekStart('2025-03-31'), '2025-03-31')
    assert.equal(weekStart('2025-04-01'), '2025-03-31')
    // 2025-10-01 is a Wednesday → back into September.
    assert.equal(weekStart('2025-10-01'), '2025-09-29')
  })

  it('is UTC-stable: identical result regardless of local timezone', () => {
    // UTC-noon parsing means the date math cannot drift; assert the full
    // Monday..Sunday week is stable around a DST transition date.
    assert.equal(weekStart('2026-03-08'), '2026-03-02') // US DST starts Mar 8, 2026 (a Sunday)
  })

  it('rejects malformed input', () => {
    assert.throws(() => weekStart('not-a-date'))
    assert.throws(() => weekStart('2025-3-1'))
    assert.throws(() => weekStart('2025-02-30')) // impossible calendar date
    assert.throws(() => weekStart(''))
  })
})

describe('formatWeekLabel (pure)', () => {
  it('renders "Week of Mar 3" style labels', () => {
    assert.equal(formatWeekLabel('2025-03-03'), 'Week of Mar 3')
    assert.equal(formatWeekLabel('2025-09-08'), 'Week of Sep 8')
  })
})

describe('quarterBounds / quarterKey (pure)', () => {
  it('produces inclusive calendar bounds', () => {
    assert.deepEqual(quarterBounds(2025, 1), { startDate: '2025-01-01', endDate: '2025-03-31' })
    assert.deepEqual(quarterBounds(2025, 2), { startDate: '2025-04-01', endDate: '2025-06-30' })
    assert.deepEqual(quarterBounds(2024, 1), { startDate: '2024-01-01', endDate: '2024-03-31' }) // leap year
    assert.deepEqual(quarterBounds(2025, 4), { startDate: '2025-10-01', endDate: '2025-12-31' })
  })

  it('keys a date to its quarter', () => {
    assert.deepEqual(quarterKey('2025-02-14'), { year: 2025, quarter: 1 })
    assert.deepEqual(quarterKey('2025-06-30'), { year: 2025, quarter: 2 })
    assert.deepEqual(quarterKey('2025-12-31'), { year: 2025, quarter: 4 })
  })
})

describe('parseDate (pure)', () => {
  it('parses at UTC noon (13:00 in half-hour zones, offset-proof)', () => {
    assert.equal(parseDate('2025-09-10').toISOString(), '2025-09-10T12:00:00.000Z')
  })

  it('assertValidDate throws on impossible dates, passes on real ones', () => {
    assert.throws(() => assertValidDate('2024-02-30'))
    assert.doesNotThrow(() => assertValidDate('2024-02-29'))
  })
})