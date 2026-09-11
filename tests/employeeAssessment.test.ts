import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { listScores, setScore } from '#/server/peopleAnalyzer'
import { createCoreValue, updateCoreValue } from '#/server/coreValues'
import { createPerson } from '#/server/people'
import { createSeat, createAssignment, setGwc, endAssignment, getPersonAssignments } from '#/server/seats'
import { getCurrentQuarter } from '#/server/quarters'
import { createTestDb, signedInUser } from './helpers'
import type { Db } from '../src/server/db'

/** Fixture helpers: all tests pass explicit quarterIds (no clock hazards). */

async function currentQuarterId(db: Db): Promise<number> {
  const q = await getCurrentQuarter(db)
  if (!q) throw new Error('quarters not seeded')
  return q.id
}

async function analyzerFixture(db: Db, token: string) {
  const person = await createPerson(db, token, { fullName: 'Zed Person' })
  if (!person.ok) throw new Error('fixture failed: person')
  const value = await createCoreValue(db, token, { name: 'Integrity', description: null })
  if (!value.ok) throw new Error('fixture failed: value')
  return { personId: person.value.id, valueId: value.value.id }
}

describe('employee assessment scoring', () => {
  it('admin sets a score; re-entering the triple overwrites (one row per triple)', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db) // admin
    const { personId, valueId } = await analyzerFixture(db, token)
    const quarterId = await currentQuarterId(db)

    const first = await setScore(db, token, { personId, quarterId, coreValueId: valueId, score: '-' })
    assert.equal(first.ok, true)
    const view1 = await listScores(db, token, quarterId)
    assert.equal(view1.ok, true)
    if (!view1.ok) throw new Error('view failed')
    assert.equal(view1.value.rows[0].scores[valueId], '-')

    // Overwrite: same triple, new score — still exactly one row.
    const second = await setScore(db, token, { personId, quarterId, coreValueId: valueId, score: '+' })
    assert.equal(second.ok, true)
    const view2 = await listScores(db, token, quarterId)
    if (!view2.ok) throw new Error('view failed')
    assert.equal(view2.value.rows[0].scores[valueId], '+')
  })

  it('scores are admin-only at the seam: members and unauthenticated get forbidden/unauthenticated', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db) // admin
    const member = await signedInUser(db, 'member')
    const { personId, valueId } = await analyzerFixture(db, token)
    const quarterId = await currentQuarterId(db)

    assert.deepEqual(
      await setScore(db, member.token, { personId, quarterId, coreValueId: valueId, score: '+' }),
      { ok: false, error: 'forbidden' },
    )
    assert.deepEqual(await listScores(db, member.token, quarterId), {
      ok: false,
      error: 'forbidden',
    })
    assert.deepEqual(
      await setScore(db, undefined, { personId, quarterId, coreValueId: valueId, score: '+' }),
      { ok: false, error: 'unauthenticated' },
    )
    assert.deepEqual(await listScores(db, undefined, quarterId), {
      ok: false,
      error: 'unauthenticated',
    })
  })

  it('scores survive core-value rename (display joins, new name) and deactivation (row kept, id stable)', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db) // admin
    const { personId, valueId } = await analyzerFixture(db, token)
    const quarterId = await currentQuarterId(db)

    assert.equal(
      (await setScore(db, token, { personId, quarterId, coreValueId: valueId, score: '+' })).ok,
      true,
    )
    // Rename: score must now display under the new name.
    const renamed = await updateCoreValue(db, token, valueId, {
      name: 'Integrity Renamed',
      description: null,
      active: true,
    })
    assert.equal(renamed.ok, true)
    let view = await listScores(db, token, quarterId)
    if (!view.ok) throw new Error('view failed')
    assert.equal(view.value.values[0].name, 'Integrity Renamed')
    assert.equal(view.value.rows[0].scores[valueId], '+')

    // Deactivate: the value leaves the active columns but keeps its column
    // (with an "(inactive)" marker) because it holds scores; row untouched.
    const deactivated = await updateCoreValue(db, token, valueId, {
      name: 'Integrity Renamed',
      description: null,
      active: false,
    })
    assert.equal(deactivated.ok, true)
    view = await listScores(db, token, quarterId)
    if (!view.ok) throw new Error('view failed')
    assert.equal(view.value.values.length, 1)
    assert.equal(view.value.values[0].active, false)
    assert.equal(view.value.rows[0].scores[valueId], '+')
  })

  it('invalid score shape and unknown entities are rejected', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db) // admin
    const { personId, valueId } = await analyzerFixture(db, token)
    const quarterId = await currentQuarterId(db)

    assert.deepEqual(
      await setScore(db, token, { personId, quarterId, coreValueId: valueId, score: '++' }),
      { ok: false, error: 'invalid_score' },
    )
    assert.deepEqual(
      await setScore(db, token, { personId: 9999, quarterId, coreValueId: valueId, score: '+' }),
      { ok: false, error: 'not_found' },
    )
    assert.deepEqual(
      await setScore(db, token, { personId, quarterId: 9999, coreValueId: valueId, score: '+' }),
      { ok: false, error: 'not_found' },
    )
    assert.deepEqual(
      await setScore(db, token, { personId, quarterId, coreValueId: 9999, score: '+' }),
      { ok: false, error: 'not_found' },
    )
    assert.deepEqual(await listScores(db, token, 9999), { ok: false, error: 'not_found' })

    // Nothing persisted by rejected writes.
    const view = await listScores(db, token, quarterId)
    if (!view.ok) throw new Error('view failed')
    assert.deepEqual(view.value.rows[0].scores, {})
  })

  it('scores are quarter-scoped: same person/value in another quarter is a separate row', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db) // admin
    const { personId, valueId } = await analyzerFixture(db, token)
    const q1 = await currentQuarterId(db)
    // Seed one extra quarter directly (quarters are seed-only and immutable;
    // the app seam exposes no write path by design).
    sqlite.exec(
      "INSERT INTO quarters (label, start_date, end_date, created_at) VALUES ('2031 Q1', '2031-01-01', '2031-03-31', '2026-01-01T00:00:00Z')",
    )
    const q2Row = await db
      .select()
      .from((await import('../src/server/schema')).quarters)
      .where((await import('drizzle-orm')).eq((await import('../src/server/schema')).quarters.label, '2031 Q1'))
      .get()
    const q2 = q2Row!.id

    await setScore(db, token, { personId, quarterId: q1, coreValueId: valueId, score: '-' })
    await setScore(db, token, { personId, quarterId: q2, coreValueId: valueId, score: '+' })
    const view1 = await listScores(db, token, q1)
    const view2 = await listScores(db, token, q2)
    if (!view1.ok || !view2.ok) throw new Error('view failed')
    assert.equal(view1.value.rows[0].scores[valueId], '-')
    assert.equal(view2.value.rows[0].scores[valueId], '+')
  })

  it('GWC summary rolls up from active assignments: 0, 1, and 2 seats; ended seats excluded', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db) // admin
    const seatA = await createSeat(db, token, { name: 'Visionary', responsibilities: [], sortOrder: 0 })
    const seatB = await createSeat(db, token, { name: 'Integrator', responsibilities: [], sortOrder: 1 })
    const seatC = await createSeat(db, token, { name: 'Ops', responsibilities: [], sortOrder: 2 })
    if (!seatA.ok || !seatB.ok || !seatC.ok) throw new Error('fixture failed: seats')
    const p0 = await createPerson(db, token, { fullName: 'No Seats' })
    const p1 = await createPerson(db, token, { fullName: 'One Seat' })
    const p2 = await createPerson(db, token, { fullName: 'Two Seats' })
    if (!p0.ok || !p1.ok || !p2.ok) throw new Error('fixture failed: people')
    const quarterId = await currentQuarterId(db)

    assert.equal(
      (await createAssignment(db, token, { personId: p1.value.id, seatId: seatA.value.id })).ok,
      true,
    )
    const a1 = await findAssignment(db, token, p1.value.id)
    assert.equal((await setGwc(db, token, a1, { get: true, want: true, capacity: true, note: null })).ok, true)
    assert.equal(
      (await createAssignment(db, token, { personId: p2.value.id, seatId: seatB.value.id })).ok,
      true,
    )
    assert.equal(
      (await createAssignment(db, token, { personId: p2.value.id, seatId: seatC.value.id })).ok,
      true,
    )
    const a2a = await findAssignment(db, token, p2.value.id, 'Integrator')
    const a2b = await findAssignment(db, token, p2.value.id, 'Ops')
    assert.equal((await setGwc(db, token, a2a, { get: true, want: true, capacity: true, note: null })).ok, true)
    // Second seat: one false rating, one unrated (null).
    assert.equal((await setGwc(db, token, a2b, { get: false, want: null, capacity: null, note: null })).ok, true)

    const view = await listScores(db, token, quarterId)
    if (!view.ok) throw new Error('view failed')
    const byName = Object.fromEntries(view.value.rows.map((r) => [r.personName, r]))

    // Person with no seats: nothing to summarize.
    assert.equal(byName['No Seats'].gwc.seats.length, 0)
    assert.equal(byName['No Seats'].gwc.allTrue, false)

    // Person with one rated seat: all true.
    assert.equal(byName['One Seat'].gwc.seats.length, 1)
    assert.equal(byName['One Seat'].gwc.allTrue, true)
    assert.equal(byName['One Seat'].verdict, 'Developing')

    // Person with two seats: includes the false + null → not allTrue, incomplete.
    assert.equal(byName['Two Seats'].gwc.seats.length, 2)
    assert.equal(byName['Two Seats'].gwc.allTrue, false)
    assert.equal(byName['Two Seats'].gwc.incomplete, true)
    assert.equal(byName['Two Seats'].verdict, 'Complete Right Fit first')
  })

  it('ended assignments stop contributing to the GWC summary', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db) // admin
    const seat = await createSeat(db, token, { name: 'Ops', responsibilities: [], sortOrder: 0 })
    if (!seat.ok) throw new Error('fixture failed: seat')
    const person = await createPerson(db, token, { fullName: 'Moved Person' })
    if (!person.ok) throw new Error('fixture failed: person')
    assert.equal((await createAssignment(db, token, { personId: person.value.id, seatId: seat.value.id })).ok, true)
    const assignmentId = await findAssignment(db, token, person.value.id)
    assert.equal(
      (await setGwc(db, token, assignmentId, { get: false, want: false, capacity: false, note: null })).ok,
      true,
    )
    // End the assignment: the false ratings must stop dragging the summary down.
    assert.equal((await endAssignment(db, token, assignmentId)).ok, true)
    const quarterId = await currentQuarterId(db)
    const view = await listScores(db, token, quarterId)
    if (!view.ok) throw new Error('view failed')
    const row = view.value.rows.find((r) => r.personId === person.value.id)
    if (!row) throw new Error('row missing')
    assert.equal(row.gwc.seats.length, 0)
    // No active seats → flags empty → not incomplete, not allTrue → GWC verdict.
    assert.equal(row.verdict, 'Right person? Not yet')
  })
})

/** Find the active assignment id for a person (optionally by seat name). */
async function findAssignment(
  db: Db,
  token: string,
  personId: number,
  seatName?: string,
): Promise<number> {
  const result = await getPersonAssignments(db, token, personId)
  if (!result.ok) throw new Error('fixture failed: assignments')
  const row = seatName
    ? result.value.find((a) => a.seatName === seatName && a.endedAt == null)
    : result.value.find((a) => a.endedAt == null)
  if (!row) throw new Error('fixture failed: no active assignment')
  return row.id
}