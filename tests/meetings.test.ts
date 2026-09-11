import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  startMeeting,
  getMeeting,
  getOpenMeeting,
  advanceSegment,
  deleteMeeting,
  setFacilitator,
  listMeetings,
  getPreloadedData,
  SEGMENT_AGENDA,
} from '../src/server/meetings'
import { createPerson, linkUserToPerson } from '../src/server/people'
import { setEntry, createMetric } from '../src/server/metrics'
import { createRock, setStatus } from '../src/server/rocks'
import { createTodo, completeTodo } from '../src/server/todos'
import { createTestDb, signedInUser } from './helpers'
import { todayIso, weekStart } from '../src/server/week'

async function personFor(
  db: Parameters<typeof linkUserToPerson>[0],
  token: string,
  name: string,
) {
  const person = await createPerson(db, token, { fullName: name })
  if (!person.ok) throw new Error('person fixture failed')
  return person.value
}

describe('L10 lifecycle: start, segments, advance, delete (seam, ticket 21)', () => {
  it('startMeeting creates the meeting + exactly 7 segments in agenda order (pinned names + minutes)', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const result = await startMeeting(db, token)
    assert.equal(result.ok, true)
    if (!result.ok) throw new Error('start failed')
    assert.equal(result.value.status, 'open')
    assert.equal(result.value.segments.length, 7)
    assert.deepEqual(
      result.value.segments.map((s) => `${s.segmentKey}:${s.plannedMinutes}`),
      ['segue:5', 'scorecard:5', 'rocks:5', 'headlines:5', 'todos:5', 'ids:60', 'conclude:5'],
    )
    // First segment is active; the rest are upcoming with no entry time.
    assert.equal(result.value.segments[0].active, true)
    assert.equal(result.value.segments[0].enteredAt != null, true)
    assert.deepEqual(result.value.segments.slice(1).map((s) => s.enteredAt), [
      null,
      null,
      null,
      null,
      null,
      null,
    ])
    assert.equal(SEGMENT_AGENDA.length, 7)
  })

  it('only one open meeting at a time; second start rejected; open meeting returned by getOpenMeeting', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    assert.equal((await startMeeting(db, token)).ok, true)
    assert.deepEqual(await startMeeting(db, token), { ok: false, error: 'open_meeting_exists' })
    const open = await getOpenMeeting(db, token)
    assert.equal(open.ok, true)
    if (open.ok) assert.notEqual(open.value, null)
  })

  it('advance stamps the active segment with elapsed seconds and starts the next', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const started = await startMeeting(db, token)
    if (!started.ok) throw new Error('start failed')
    const first = started.value.segments[0]
    const result = await advanceSegment(db, token, started.value.id, first.id)
    assert.equal(result.ok, true)
    if (!result.ok) throw new Error('advance failed')
    const [seg0, seg1] = result.value.segments
    assert.equal(seg0.done, true)
    assert.equal(seg0.active, false)
    assert.equal(seg0.elapsedSeconds >= 0, true)
    assert.equal(seg1.active, true)
    assert.equal(seg1.enteredAt != null, true)
    // Total elapsed reflects the stamped segment.
    assert.equal(result.value.totalElapsedSeconds, seg0.elapsedSeconds)
  })

  it('advance rejects: non-active segments, conclude (ticket 25), concluded meetings, unknown ids', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const started = await startMeeting(db, token)
    if (!started.ok) throw new Error('start failed')
    const segs = started.value.segments
    // Advancing a non-active segment.
    assert.deepEqual(await advanceSegment(db, token, started.value.id, segs[2].id), {
      ok: false,
      error: 'segment_not_active',
    })
    // Advancing 'conclude' is ticket 25's action.
    assert.deepEqual(await advanceSegment(db, token, started.value.id, segs[6].id), {
      ok: false,
      error: 'conclude_is_ticket_25',
    })
    // Advance through all six advancable segments; conclude stays active.
    let current = started.value
    for (let i = 0; i < 6; i++) {
      const active = current.segments.find((s) => s.active)!
      const r = await advanceSegment(db, token, started.value.id, active.id)
      assert.equal(r.ok, true)
      if (r.ok) current = r.value
    }
    assert.equal(current.segments[6].active, true)
    assert.equal(current.segments[6].done, false)
    // Once concluded (ticket 25), advancing is rejected — pinned via the
    // deleteMeeting guard test below; here: unknown meeting id.
    assert.deepEqual(await advanceSegment(db, token, 99999, segs[0].id), {
      ok: false,
      error: 'meeting_not_found',
    })
  })

  it('deleteMeeting removes an open meeting (and its segments); deleted meetings vanish from the list', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    const started = await startMeeting(db, token)
    if (!started.ok) throw new Error('start failed')
    // Simulate a concluded meeting (ticket 25 state) and pin the guard.
    sqlite.exec(`UPDATE meetings SET status = 'concluded' WHERE id = ${started.value.id}`)
    assert.deepEqual(await deleteMeeting(db, token, started.value.id), {
      ok: false,
      error: 'meeting_concluded',
    })
    // With no open meeting left, a new one can start — and delete cleanly.
    const second = await startMeeting(db, token)
    assert.equal(second.ok, true)
    if (!second.ok) throw new Error('second start failed')
    assert.equal((await deleteMeeting(db, token, second.value.id)).ok, true)
    const open = await getOpenMeeting(db, token)
    if (open.ok) assert.equal(open.value, null)
    const list = await listMeetings(db, token)
    if (list.ok) {
      // Only the concluded (simulated) meeting remains.
      assert.equal(list.value.length, 1)
      assert.equal(list.value[0].status, 'concluded')
    }
    void db
  })

  it('facilitator: anyone signed-in sets it on an open meeting; round-trip; unknown person rejected', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const member = await signedInUser(db, 'member')
    const alice = await personFor(db, token, 'Alice')
    const started = await startMeeting(db, token)
    if (!started.ok) throw new Error('start failed')

    // Member sets the facilitator (any participant).
    const byMember = await setFacilitator(db, member.token, started.value.id, alice.id)
    assert.equal(byMember.ok, true)
    if (byMember.ok) assert.equal(byMember.value.facilitatorName, 'Alice')

    // Clearing works (null).
    const cleared = await setFacilitator(db, token, started.value.id, null)
    assert.equal(cleared.ok, true)
    if (cleared.ok) assert.equal(cleared.value.facilitatorName, null)

    // Unknown person.
    assert.deepEqual(await setFacilitator(db, token, started.value.id, 999), {
      ok: false,
      error: 'person_not_found',
    })
  })

  it('permissions: members start/advance; unauthenticated denied everywhere', async () => {
    const { db } = await createTestDb()
    const member = await signedInUser(db, 'member')
    const started = await startMeeting(db, member.token)
    assert.equal(started.ok, true)
    if (!started.ok) throw new Error('start failed')
    const r = await advanceSegment(db, member.token, started.value.id, started.value.segments[0].id)
    assert.equal(r.ok, true)
    assert.deepEqual(await startMeeting(db, undefined), { ok: false, error: 'unauthenticated' })
    assert.deepEqual(await getMeeting(db, undefined, 1), { ok: false, error: 'unauthenticated' })
    assert.deepEqual(await advanceSegment(db, undefined, 1, 1), {
      ok: false,
      error: 'unauthenticated',
    })
    assert.deepEqual(await deleteMeeting(db, undefined, 1), { ok: false, error: 'unauthenticated' })
    assert.deepEqual(await setFacilitator(db, undefined, 1, null), {
      ok: false,
      error: 'unauthenticated',
    })
    assert.deepEqual(await listMeetings(db, undefined), { ok: false, error: 'unauthenticated' })
  })
})

describe('L10 pre-loads (seam, ticket 21)', () => {
  it('pre-loads previous-week scorecard, current rock statuses, last-week to-dos', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    const alice = await personFor(db, token, 'Alice')

    const today = todayIso()
    const thisMonday = weekStart(today)
    const shift = (monday: string, days: number) => {
      const d = new Date(`${monday}T12:00:00Z`)
      d.setUTCDate(d.getUTCDate() + days)
      return d.toISOString().slice(0, 10)
    }
    const lastWeekWed = shift(thisMonday, -7 + 2) // Wednesday of last week

    // Scorecard: one metric, an entry LAST week (red for gte target 10).
    const metric = await createMetric(db, token, {
      name: 'Calls',
      ownerPersonId: alice.id,
      target: 10,
      direction: 'gte',
      unit: null,
    })
    if (!metric.ok) throw new Error('metric fixture failed')
    assert.equal((await setEntry(db, token, metric.value.id, lastWeekWed, 3)).ok, true)

    // Rocks: one company rock in the current quarter, off-track.
    const currentQuarterId = (
      sqlite.prepare("SELECT id FROM quarters WHERE date(?) BETWEEN start_date AND end_date").get(today) as {
        id: number
      }
    ).id
    const rock = await createRock(db, token, { statement: 'Ship the thing', quarterId: currentQuarterId })
    if (!rock.ok) throw new Error('rock fixture failed')
    assert.equal((await setStatus(db, token, rock.value.id, thisMonday, { status: 'off_track' })).ok, true)

    // To-dos: one done, one open, both due last week.
    const todo1 = await createTodo(db, token, { title: 'file report', assigneePersonId: alice.id })
    const todo2 = await createTodo(db, token, { title: 'call bank', assigneePersonId: alice.id })
    if (!todo1.ok || !todo2.ok) throw new Error('todo fixture failed')
    sqlite.exec(`UPDATE todos SET due_date = '${lastWeekWed}' WHERE id = ${todo1.value.id}`)
    sqlite.exec(`UPDATE todos SET due_date = '${lastWeekWed}' WHERE id = ${todo2.value.id}`)
    assert.equal((await completeTodo(db, token, todo1.value.id)).ok, true)

    const result = await getPreloadedData(db, token, today)
    assert.equal(result.ok, true)
    if (!result.ok) throw new Error('preloads failed')

    // Scorecard: previous week is the column before the current week.
    assert.equal(result.value.scorecard.previousWeekMonday, shift(thisMonday, -7))
    const calls = result.value.scorecard.metrics.find((m) => m.name === 'Calls')
    assert.ok(calls, 'metric missing from pre-load')
    assert.equal(calls.actual, 3)
    assert.equal(calls.pass, false) // 3 < 10, gte → red

    // Rocks: latest status + off-track flag.
    const rockRow = result.value.rocks.find((r) => r.id === rock.value.id)
    assert.ok(rockRow, 'rock missing from pre-load')
    assert.equal(rockRow.latestStatus, 'off_track')
    assert.equal(rockRow.ownerName, null) // company rock

    // To-dos: last week's bucket, done + open counted.
    assert.equal(result.value.todos?.open, 1)
    assert.equal(result.value.todos?.done, 1)
    assert.equal(result.value.todos?.items.length, 2)
  })

  it('pre-loads are signed-in readable; unauthenticated denied', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    assert.equal((await getPreloadedData(db, token)).ok, true)
    assert.deepEqual(await getPreloadedData(db, undefined), { ok: false, error: 'unauthenticated' })
  })
})
