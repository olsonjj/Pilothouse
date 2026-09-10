import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createSeat,
  createAssignment,
  endAssignment,
  setGwc,
  getSeat,
  getPersonAssignments,
} from '../src/server/seats'
import { createPerson } from '../src/server/people'
import { createTestDb, signedInUser } from './helpers'

/** Admin token + one person + one seat with an active assignment. */
async function gwcFixture() {
  const { db, sqlite, dir } = await createTestDb()
  const { token } = await signedInUser(db)
  const person = await createPerson(db, token, { fullName: 'Alice' })
  const seat = await createSeat(db, token, { name: 'CEO' })
  if (!person.ok || !seat.ok) throw new Error('fixture failed')
  const assignment = await createAssignment(db, token, {
    personId: person.value.id,
    seatId: seat.value.id,
  })
  if (!assignment.ok) throw new Error('assignment fixture failed')
  return { db, sqlite, dir, token, person: person.value, seat: seat.value, assignmentId: assignment.value.id }
}

describe('GWC ratings (seam, ticket 09)', () => {
  it('admin sets GWC on an active assignment; getSeat occupants round-trip it', async () => {
    const { db, token, assignmentId, seat } = await gwcFixture()
    const result = await setGwc(db, token, assignmentId, {
      get: true,
      want: true,
      capacity: false,
      note: 'Great fit, needs a deputy',
    })
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.value.get, true)
      assert.equal(result.value.want, true)
      assert.equal(result.value.capacity, false)
      assert.equal(result.value.note, 'Great fit, needs a deputy')
    }

    const detail = await getSeat(db, token, seat.id)
    assert.equal(detail.ok, true)
    if (detail.ok) {
      assert.equal(detail.value.occupants.length, 1)
      const o = detail.value.occupants[0]!
      assert.equal(o.personName, 'Alice')
      assert.deepEqual(o.gwc, {
        get: true,
        want: true,
        capacity: false,
        note: 'Great fit, needs a deputy',
      })
    }
  })

  it('setGwc overwrites (partial input clears to null) and members/unauthenticated are denied', async () => {
    const { db, token, assignmentId, seat } = await gwcFixture()
    const member = await signedInUser(db, 'member')

    assert.equal(
      (await setGwc(db, token, assignmentId, { get: true, want: null, capacity: null, note: null }))
        .ok,
      true,
    )
    // Full overwrite: nulls clear previously set values.
    assert.equal(
      (await setGwc(db, token, assignmentId, { get: null, want: false, capacity: null, note: null }))
        .ok,
      true,
    )
    const detail = await getSeat(db, token, seat.id)
    assert.equal(detail.ok, true)
    if (detail.ok) {
      assert.equal(detail.value.occupants.length, 1)
      const g = detail.value.occupants[0]!.gwc
      assert.equal(g.get, null)
      assert.equal(g.want, false)
    }

    assert.deepEqual(
      await setGwc(db, member.token, assignmentId, {
        get: true,
        want: null,
        capacity: null,
        note: null,
      }),
      { ok: false, error: 'forbidden' },
    )
    assert.deepEqual(
      await setGwc(db, undefined, assignmentId, { get: true, want: null, capacity: null, note: null }),
      { ok: false, error: 'unauthenticated' },
    )
  })

  it('ended assignments reject GWC edits; history keeps stored ratings', async () => {
    const { db, token, assignmentId, seat } = await gwcFixture()
    assert.equal(
      (
        await setGwc(db, token, assignmentId, {
          get: true,
          want: true,
          capacity: true,
          note: 'stellar',
        })
      ).ok,
      true,
    )
    assert.equal((await endAssignment(db, token, assignmentId)).ok, true)
    assert.deepEqual(
      await setGwc(db, token, assignmentId, { get: false, want: null, capacity: null, note: null }),
      { ok: false, error: 'already_ended' },
    )
    // History row retains the ratings that were set while active.
    const detail = await getSeat(db, token, seat.id)
    assert.equal(detail.ok, true)
    if (detail.ok) {
      assert.equal(detail.value.occupants.length, 0)
      const h = detail.value.history[0]!
      assert.deepEqual(h.gwc, { get: true, want: true, capacity: true, note: 'stellar' })
    }
  })

  it('getPersonAssignments surfaces GWC per assignment; occupant joins stay aligned', async () => {
    const { db, token, person, seat, assignmentId } = await gwcFixture()
    assert.equal(
      (await setGwc(db, token, assignmentId, { get: true, want: null, capacity: true, note: null }))
        .ok,
      true,
    )
    const rows = await getPersonAssignments(db, token, person.id)
    assert.equal(rows.ok, true)
    if (!rows.ok) return
    assert.equal(rows.value.length, 1)
    const row = rows.value[0]!
    assert.equal(row.seatName, seat.name)
    assert.equal(row.gwc.get, true)
    assert.equal(row.gwc.want, null)
    assert.equal(row.gwc.capacity, true)

    // Join-aliasing regression (ticket-02 class): GWC set only on this seat's
    // occupant; a child seat occupant without GWC must not inherit it.
    const bob = await createPerson(db, token, { fullName: 'Bob' })
    const ops = await createSeat(db, token, { name: 'Ops', parentSeatId: seat.id })
    if (!bob.ok || !ops.ok) throw new Error('fixture failed')
    assert.equal(
      (await createAssignment(db, token, { personId: bob.value.id, seatId: ops.value.id })).ok,
      true,
    )
    const seats = await getSeat(db, token, seat.id)
    assert.equal(seats.ok, true)
    if (seats.ok) {
      // Alice's row keeps her GWC; Bob (different seat) is unrated.
      assert.equal(seats.value.occupants.length, 1)
      assert.equal(seats.value.occupants[0]!.personName, 'Alice')
      assert.equal(seats.value.occupants[0]!.gwc.get, true)
    }
    const opsDetail = await getSeat(db, token, ops.value.id)
    assert.equal(opsDetail.ok, true)
    if (opsDetail.ok) {
      assert.equal(opsDetail.value.occupants[0]!.personName, 'Bob')
      assert.deepEqual(opsDetail.value.occupants[0]!.gwc, {
        get: null,
        want: null,
        capacity: null,
        note: null,
      })
    }
  })

  it('rejects unknown assignments, non-boolean values, and oversized notes', async () => {
    const { db, token, assignmentId } = await gwcFixture()
    assert.deepEqual(
      await setGwc(db, token, 999, { get: true, want: null, capacity: null, note: null }),
      { ok: false, error: 'not_found' },
    )
    assert.deepEqual(
      await setGwc(db, token, assignmentId, {
        get: 'yes' as unknown as boolean,
        want: null,
        capacity: null,
        note: null,
      }),
      { ok: false, error: 'invalid_input' },
    )
    assert.deepEqual(
      await setGwc(db, token, assignmentId, {
        get: null,
        want: null,
        capacity: null,
        note: 'x'.repeat(1001),
      }),
      { ok: false, error: 'invalid_input' },
    )
  })
})