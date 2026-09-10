import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createSeat,
  updateSeat,
  createAssignment,
  endAssignment,
  listSeats,
  getSeat,
  getPersonAssignments,
} from '../src/server/seats'
import { createPerson } from '../src/server/people'
import { seatAssignments } from '../src/server/schema'
import { eq } from 'drizzle-orm'
import { createTestDb, signedInUser } from './helpers'

/** Admin token fixture with two people created for assignment tests. */
async function seatFixture(db: Awaited<ReturnType<typeof createTestDb>>['db']) {
  const { token } = await signedInUser(db)
  const a = await createPerson(db, token, { fullName: 'Alice' })
  const b = await createPerson(db, token, { fullName: 'Bob' })
  if (!a.ok || !b.ok) throw new Error('person fixture failed')
  return { token, alice: a.value, bob: b.value }
}

describe('seat CRUD (seam)', () => {
  it('admin creates a seat with ordered responsibilities and a parent', async () => {
    const { db } = await createTestDb()
    const { token } = await seatFixture(db)
    const top = await createSeat(db, token, {
      name: 'Integrator',
      description: 'Runs the day-to-day',
      responsibilities: ['Owns L10', 'Runs scorecard'],
      sortOrder: 1,
    })
    assert.equal(top.ok, true)
    if (!top.ok) return
    assert.deepEqual(top.value.responsibilities, '["Owns L10","Runs scorecard"]')
    assert.equal(top.value.parentSeatId, null)

    const child = await createSeat(db, token, {
      name: 'Ops Lead',
      parentSeatId: top.value.id,
    })
    assert.equal(child.ok, true)
    if (!child.ok) return
    assert.equal(child.value.parentSeatId, top.value.id)
  })

  it('rejects blank names, unknown parents, and malformed responsibilities', async () => {
    const { db } = await createTestDb()
    const { token } = await seatFixture(db)
    assert.deepEqual(await createSeat(db, token, { name: '  ' }), {
      ok: false,
      error: 'name_required',
    })
    assert.deepEqual(await createSeat(db, token, { name: 'X', parentSeatId: 424242 }), {
      ok: false,
      error: 'not_found',
    })
    assert.deepEqual(await createSeat(db, token, { name: 'X', responsibilities: 'nope' as never }), {
      ok: false,
      error: 'invalid_input',
    })
  })

  it('members cannot create, update, or assign; unauthenticated is rejected', async () => {
    const { db } = await createTestDb()
    const { token: admin } = await seatFixture(db)
    const member = await signedInUser(db, 'member')
    assert.deepEqual(await createSeat(db, member.token, { name: 'Sneaky' }), {
      ok: false,
      error: 'forbidden',
    })
    const seat = await createSeat(db, admin, { name: 'Seat' })
    if (!seat.ok) throw new Error('fixture failed')
    assert.deepEqual(await updateSeat(db, member.token, seat.value.id, { name: 'Hacked' }), {
      ok: false,
      error: 'forbidden',
    })
    assert.deepEqual(
      await createAssignment(db, member.token, {
        personId: 1,
        seatId: seat.value.id,
      }),
      { ok: false, error: 'forbidden' },
    )
    assert.deepEqual(await listSeats(db, undefined), { ok: false, error: 'unauthenticated' })
    assert.deepEqual(await getSeat(db, undefined, seat.value.id), {
      ok: false,
      error: 'unauthenticated',
    })
  })

  it('updateSeat rejects a parent that would create a cycle', async () => {
    const { db } = await createTestDb()
    const { token } = await seatFixture(db)
    const top = await createSeat(db, token, { name: 'CEO' })
    if (!top.ok) throw new Error('fixture failed')
    const mid = await createSeat(db, token, { name: 'Integrator', parentSeatId: top.value.id })
    if (!mid.ok) throw new Error('fixture failed')
    const leaf = await createSeat(db, token, { name: 'Ops', parentSeatId: mid.value.id })
    if (!leaf.ok) throw new Error('fixture failed')

    // CEO's parent becomes Ops → CEO→Integrator→Ops→CEO loop.
    assert.deepEqual(await updateSeat(db, token, top.value.id, { name: 'CEO', parentSeatId: leaf.value.id }), {
      ok: false,
      error: 'cycle',
    })
    // Self-parent is also a cycle.
    assert.deepEqual(await updateSeat(db, token, top.value.id, { name: 'CEO', parentSeatId: top.value.id }), {
      ok: false,
      error: 'cycle',
    })
    // A legitimate reparent still works.
    const moved = await updateSeat(db, token, leaf.value.id, {
      name: 'Ops',
      parentSeatId: top.value.id,
    })
    assert.equal(moved.ok, true)
  })
})

describe('assignment caps (seam)', () => {
  it('a person can hold two active seats but not three', async () => {
    const { db } = await createTestDb()
    const { token, alice } = await seatFixture(db)
    const s1 = await createSeat(db, token, { name: 'Integrator' })
    const s2 = await createSeat(db, token, { name: 'Visionary' })
    const s3 = await createSeat(db, token, { name: 'Ops' })
    if (!s1.ok || !s2.ok || !s3.ok) throw new Error('fixture failed')

    assert.equal((await createAssignment(db, token, { personId: alice.id, seatId: s1.value.id })).ok, true)
    assert.equal((await createAssignment(db, token, { personId: alice.id, seatId: s2.value.id })).ok, true)
    assert.deepEqual(
      await createAssignment(db, token, { personId: alice.id, seatId: s3.value.id }),
      { ok: false, error: 'person_seat_limit' },
    )
  })

  it('a seat holds one active occupant; ending frees it', async () => {
    const { db } = await createTestDb()
    const { token, alice, bob } = await seatFixture(db)
    const seat = await createSeat(db, token, { name: 'Sales' })
    if (!seat.ok) throw new Error('fixture failed')

    assert.equal((await createAssignment(db, token, { personId: alice.id, seatId: seat.value.id, startDate: '2026-06-01' })).ok, true)
    assert.deepEqual(
      await createAssignment(db, token, { personId: bob.id, seatId: seat.value.id }),
      { ok: false, error: 'seat_occupied' },
    )

    // End Alice's assignment (history kept), now Bob can take the seat.
    const active = await db
      .select()
      .from(seatAssignments)
      .where(eq(seatAssignments.personId, alice.id))
      .get()
    assert.ok(active)
    const ended = await endAssignment(db, token, active.id, '2026-08-31')
    assert.equal(ended.ok, true)
    if (!ended.ok) return
    assert.equal(ended.value.endedAt, '2026-08-31')

    const reassign = await createAssignment(db, token, { personId: bob.id, seatId: seat.value.id })
    assert.equal(reassign.ok, true)

    // History survived: two rows for the seat, one ended.
    const history = (await db.select().from(seatAssignments).all()).filter(
      (a) => a.seatId === seat.value.id,
    )
    assert.equal(history.length, 2)
    assert.equal(history.filter((a) => a.endedAt != null).length, 1)
  })

  it('rejects ending twice, bad dates, and unknown references', async () => {
    const { db } = await createTestDb()
    const { token, alice } = await seatFixture(db)
    const seat = await createSeat(db, token, { name: 'Sales' })
    if (!seat.ok) throw new Error('fixture failed')
    const assigned = await createAssignment(db, token, {
      personId: alice.id,
      seatId: seat.value.id,
      startDate: '2026-08-01',
    })
    if (!assigned.ok) throw new Error('fixture failed')

    assert.deepEqual(await createAssignment(db, token, { personId: 424242, seatId: seat.value.id }), {
      ok: false,
      error: 'not_found',
    })
    assert.deepEqual(
      await createAssignment(db, token, { personId: alice.id, seatId: 424242 }),
      { ok: false, error: 'not_found' },
    )
    assert.deepEqual(
      await createAssignment(db, token, { personId: alice.id, seatId: seat.value.id, startDate: 'Aug 1' }),
      { ok: false, error: 'invalid_date' },
    )
    assert.deepEqual(await endAssignment(db, token, 424242), { ok: false, error: 'not_found' })
    // End date before start date is invalid.
    assert.deepEqual(await endAssignment(db, token, assigned.value.id, '2026-07-01'), {
      ok: false,
      error: 'invalid_date',
    })
    const ended = await endAssignment(db, token, assigned.value.id, '2026-08-15')
    assert.equal(ended.ok, true)
    assert.deepEqual(await endAssignment(db, token, assigned.value.id), {
      ok: false,
      error: 'already_ended',
    })
  })
})

describe('listSeats / getSeat joins (seam)', () => {
  /**
   * Regression pattern from ticket 02: duplicate join column names collapse in
   * the node:sqlite proxy driver, so occupants could map to the wrong person.
   * Distinct names + per-seat assertions make any misalignment loud.
   */
  it('maps occupants to the right seats and people', async () => {
    const { db } = await createTestDb()
    const { token, alice, bob } = await seatFixture(db)
    const sales = await createSeat(db, token, { name: 'Sales', sortOrder: 2 })
    if (!sales.ok) throw new Error('fixture failed')
    const ops = await createSeat(db, token, {
      name: 'Ops',
      parentSeatId: sales.value.id,
      sortOrder: 1,
    })
    if (!ops.ok) throw new Error('fixture failed')

    assert.equal((await createAssignment(db, token, { personId: bob.id, seatId: sales.value.id })).ok, true)
    assert.equal((await createAssignment(db, token, { personId: alice.id, seatId: ops.value.id })).ok, true)

    const result = await listSeats(db, token)
    assert.equal(result.ok, true)
    if (!result.ok) return
    const byId = new Map(result.value.map((s) => [s.id, s]))
    const salesRow = byId.get(sales.value.id)!
    const opsRow = byId.get(ops.value.id)
    if (!opsRow) throw new Error('ops seat missing from list')
    assert.deepEqual(salesRow.occupants.map((o) => o.personName), ['Bob'])
    assert.deepEqual(opsRow.occupants.map((o) => o.personName), ['Alice'])
    // Responsibilities parsed to arrays in the view.
    assert.deepEqual(salesRow.responsibilities, [])
  })

  it('getSeat returns seat + occupants + full history', async () => {
    const { db } = await createTestDb()
    const { token, alice, bob } = await seatFixture(db)
    const seat = await createSeat(db, token, {
      name: 'Marketing',
      responsibilities: ['Owns brand'],
    })
    if (!seat.ok) throw new Error('fixture failed')
    const first = await createAssignment(db, token, {
      personId: alice.id,
      seatId: seat.value.id,
      startDate: '2026-01-05',
    })
    if (!first.ok) throw new Error('fixture failed')
    await endAssignment(db, token, first.value.id, '2026-06-30')
    await createAssignment(db, token, { personId: bob.id, seatId: seat.value.id })

    const result = await getSeat(db, token, seat.value.id)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.deepEqual(result.value.responsibilities, ['Owns brand'])
    assert.equal(result.value.occupants.length, 1)
    assert.equal(result.value.occupants[0].personName, 'Bob')
    assert.equal(result.value.history.length, 2)
    assert.deepEqual(
      result.value.history.map((h) => [h.personName, h.endedAt]),
      [
        ['Alice', '2026-06-30'],
        ['Bob', null],
      ],
    )
    assert.equal((await getSeat(db, token, 424242)).ok, false)
  })

  it('getPersonAssignments lists a person’s seats across the chart', async () => {
    const { db } = await createTestDb()
    const { token, alice } = await seatFixture(db)
    const s1 = await createSeat(db, token, { name: 'Integrator' })
    const s2 = await createSeat(db, token, { name: 'Visionary' })
    if (!s1.ok || !s2.ok) throw new Error('fixture failed')
    await createAssignment(db, token, { personId: alice.id, seatId: s1.value.id })
    await createAssignment(db, token, { personId: alice.id, seatId: s2.value.id })

    const result = await getPersonAssignments(db, token, alice.id)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.value.length, 2)
    for (const row of result.value) {
      assert.equal(row.personId, alice.id)
      assert.equal(row.personName, 'Alice')
      assert.ok([s1.value.id, s2.value.id].includes(row.seatId))
    }
    assert.equal((await getPersonAssignments(db, token, 424242)).ok, false)
  })
})