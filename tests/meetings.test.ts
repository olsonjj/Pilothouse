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
  saveSegmentNotes,
  pushToMeeting,
  pushRedCell,
  pushOffTrackRock,
  pushMissedTodo,
  pushHeadline,
  listMeetingIssues,
  removeMeetingIssue,
  pullLongTermIssues,
  solveMeetingIssue,
  concludeMeeting,
  setRating,
  listMeetingRecap,
  ratingTrend,
  SEGMENT_AGENDA,
} from '../src/server/meetings'
import { createPerson, linkUserToPerson } from '../src/server/people'
import { setEntry, createMetric } from '../src/server/metrics'
import { createRock, setStatus } from '../src/server/rocks'
import { createTodo, completeTodo, dueDateFrom } from '../src/server/todos'
import { addIssue, resolveIssue, listIssues } from '../src/server/issues'
import { issueResolutions, todos as todosTable } from '../src/server/schema'
import { eq } from 'drizzle-orm'
import { createTestDb, signedInUser } from './helpers'
import { todayIso, weekStart } from '../src/server/week'

/** Seam-level direct-SQL seeding helper (node:sqlite via the test db). */
function sqliteExec(sqlite: { exec(sql: string): void }, sql: string): void {
  sqlite.exec(sql)
}

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
      error: 'conclude_explicit',
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
    // advanceSegment on a concluded meeting is also rejected (guard pin).
    const concludedSegs = started.value.segments
    const concludeSeg = concludedSegs.find((s) => s.segmentKey === 'conclude')
    if (!concludeSeg) throw new Error('conclude segment missing')
    assert.deepEqual(await advanceSegment(db, token, started.value.id, concludeSeg.id), {
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

describe('Segment notes: save, last-write-wins, guards (seam, ticket 22)', () => {
  it('save round-trips through getMeeting; ANY participant saves; last write wins (pinned)', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const member = await signedInUser(db, 'member')
    const started = await startMeeting(db, token)
    if (!started.ok) throw new Error('start failed')
    const segue = started.value.segments.find((s) => s.segmentKey === 'segue')
    if (!segue) throw new Error('segue segment missing')

    // Creator saves first.
    assert.equal(
      (await saveSegmentNotes(db, token, started.value.id, segue.id, 'first draft')).ok,
      true,
    )
    // ANY participant (member, not creator) saves second — last-write-wins.
    assert.equal(
      (await saveSegmentNotes(db, member.token, started.value.id, segue.id, 'member notes')).ok,
      true,
    )

    // The polling model: state changes are visible through subsequent reads.
    const read = await getMeeting(db, member.token, started.value.id)
    assert.equal(read.ok, true)
    if (!read.ok) throw new Error('read failed')
    const readSeg = read.value.segments.find((s) => s.id === segue.id)
    assert.ok(readSeg)
    // Pinned: the SECOND write is the content — no merge, no versioning.
    assert.equal(readSeg.notes, 'member notes')
  })

  it('save on a concluded meeting is rejected; on a deleted meeting → not_found; unauth denied', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    const started = await startMeeting(db, token)
    if (!started.ok) throw new Error('start failed')
    const seg = started.value.segments[0]

    // Concluded (simulated — conclusion itself is ticket 25).
    sqlite.exec(`UPDATE meetings SET status = 'concluded' WHERE id = ${started.value.id}`)
    assert.deepEqual(await saveSegmentNotes(db, token, started.value.id, seg.id, 'x'), {
      ok: false,
      error: 'meeting_concluded',
    })
    // Restore open, then delete: saving to a deleted meeting → not_found.
    sqlite.exec(`UPDATE meetings SET status = 'open' WHERE id = ${started.value.id}`)
    assert.equal((await deleteMeeting(db, token, started.value.id)).ok, true)
    assert.deepEqual(await saveSegmentNotes(db, token, started.value.id, seg.id, 'x'), {
      ok: false,
      error: 'meeting_not_found',
    })
    assert.deepEqual(await saveSegmentNotes(db, undefined, started.value.id, seg.id, 'x'), {
      ok: false,
      error: 'unauthenticated',
    })
  })

  it('size cap: 100KB+1 rejected with notes_too_large; 100KB exactly accepted', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const started = await startMeeting(db, token)
    if (!started.ok) throw new Error('start failed')
    const seg = started.value.segments[0]
    assert.deepEqual(
      await saveSegmentNotes(db, token, started.value.id, seg.id, 'a'.repeat(100_001)),
      { ok: false, error: 'notes_too_large' },
    )
    // Rejected writes persist nothing — read IMMEDIATELY after the rejection
    // (before any accepted write can mask it).
    const rejectedRead = await getMeeting(db, token, started.value.id)
    if (!rejectedRead.ok) throw new Error('read failed')
    assert.equal(
      rejectedRead.value.segments.find((s) => s.id === seg.id)?.notes,
      '',
    )
    assert.equal(
      (await saveSegmentNotes(db, token, started.value.id, seg.id, 'a'.repeat(100_000))).ok,
      true,
    )
  })

  it('unknown segment for the meeting rejected; notes visible to other participants via read', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const other = await signedInUser(db, 'member')
    const started = await startMeeting(db, token)
    if (!started.ok) throw new Error('start failed')
    const seg = started.value.segments[0]
    assert.deepEqual(await saveSegmentNotes(db, token, started.value.id, 9999, 'x'), {
      ok: false,
      error: 'segment_not_found',
    })
    // A segment from a DIFFERENT meeting → segment_not_found. Constructively:
    // delete meeting 1, start meeting 2, then try meeting-1's segment id.
    assert.equal((await deleteMeeting(db, token, started.value.id)).ok, true)
    const second = await startMeeting(db, token)
    if (!second.ok) throw new Error('second start failed')
    assert.deepEqual(await saveSegmentNotes(db, token, second.value.id, seg.id, 'x'), {
      ok: false,
      error: 'segment_not_found',
    })
    void other
    // Save + read from the other participant (polling model) — on meeting 2.
    const seg2 = second.value.segments[0]
    assert.equal((await saveSegmentNotes(db, token, second.value.id, seg2.id, 'shared')).ok, true)
    const read = await getMeeting(db, other.token, second.value.id)
    if (!read.ok) throw new Error('read failed')
    assert.equal(read.value.segments.find((s) => s.id === seg2.id)?.notes, 'shared')
  })
})

// ---------------------------------------------------------------------------
// Ticket 23: the meeting's IDS queue — one-click pushes with provenance.
// ---------------------------------------------------------------------------

describe('Meeting issue queue: push, dedup, remove (seam, ticket 23)', () => {
  it('pushToMeeting round-trips via listMeetingIssues; duplicate push is idempotent; ordered by push time', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const started = await startMeeting(db, token)
    if (!started.ok) throw new Error('start failed')
    const a = await addIssue(db, token, { title: 'Issue A', classification: 'long_term' })
    const b = await addIssue(db, token, { title: 'Issue B', classification: 'long_term' })
    if (!a.ok || !b.ok) throw new Error('fixture failed')

    const first = await pushToMeeting(db, token, started.value.id, a.value.id)
    assert.equal(first.ok, true)
    if (first.ok) assert.equal(first.value.alreadyQueued, false)
    const second = await pushToMeeting(db, token, started.value.id, b.value.id)
    assert.equal(second.ok, true)

    // Duplicate push: idempotent ok (alreadyQueued), still ONE row.
    const dup = await pushToMeeting(db, token, started.value.id, a.value.id)
    assert.equal(dup.ok, true)
    if (dup.ok) assert.equal(dup.value.alreadyQueued, true)

    const queue = await listMeetingIssues(db, token, started.value.id)
    assert.equal(queue.ok, true)
    if (!queue.ok) throw new Error('list failed')
    assert.equal(queue.value.length, 2) // deduped
    assert.deepEqual(queue.value.map((mi) => mi.title), ['Issue A', 'Issue B']) // push order
    assert.deepEqual(queue.value.map((mi) => mi.origin), ['manual', 'manual'])
    assert.deepEqual(queue.value.map((mi) => mi.status), ['open', 'open'])
    assert.deepEqual(queue.value.map((mi) => mi.state), ['in_ids', 'in_ids'])
    // Join alignment: meetingIssueId ↔ title pairing is coherent.
    const dupRow = queue.value.find((mi) => mi.title === 'Issue A')
    if (dup && first.ok) assert.equal(dupRow?.meetingIssueId, first.value.meetingIssueId)
  })

  it('pushToMeeting guards: unauth denied; concluded meeting rejected; short-term and resolved issues rejected', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    const started = await startMeeting(db, token)
    if (!started.ok) throw new Error('start failed')

    assert.equal((await pushToMeeting(db, undefined, started.value.id, 1)).ok, false)

    const shortIssue = await addIssue(db, token, { title: 'short', classification: 'short_term' })
    if (!shortIssue.ok) throw new Error('fixture failed')
    assert.deepEqual(await pushToMeeting(db, token, started.value.id, shortIssue.value.id), {
      ok: false,
      error: 'issue_not_long_term',
    })

    const longIssue = await addIssue(db, token, { title: 'long', classification: 'long_term' })
    if (!longIssue.ok) throw new Error('fixture failed')
    assert.equal((await resolveIssue(db, token, longIssue.value.id, { outcome: 'solved', note: 'done' })).ok, true)
    assert.deepEqual(await pushToMeeting(db, token, started.value.id, longIssue.value.id), {
      ok: false,
      error: 'issue_resolved',
    })

    // Concluded meeting (simulate ticket-25 state): push rejected.
    sqliteExec(sqlite, `UPDATE meetings SET status = 'concluded' WHERE id = ${started.value.id}`)
    assert.deepEqual(await pushToMeeting(db, token, started.value.id, longIssue.value.id), {
      ok: false,
      error: 'meeting_concluded',
    })
  })

  it('pushRedCell: red cell queues from_scorecard issue with entry source; green cell rejected (not_red)', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    const started = await startMeeting(db, token)
    if (!started.ok) throw new Error('start failed')
    const monday = weekStart(todayIso())
    const metric = await createMetric(db, token, {
      name: 'Calls',
      ownerPersonId: (await personFor(db, token, 'Owner')).id,
      target: 10,
      direction: 'gte',
      unit: null,
    })
    if (!metric.ok) throw new Error('metric fixture failed')
    const entry = await setEntry(db, token, metric.value.id, monday, 3) // 3 < 10 = red
    if (!entry.ok) throw new Error('entry fixture failed')

    const pushed = await pushRedCell(db, token, started.value.id, entry.value.id)
    assert.equal(pushed.ok, true)
    const queue = await listMeetingIssues(db, token, started.value.id)
    if (!queue.ok) throw new Error('list failed')
    assert.equal(queue.value.length, 1)
    assert.equal(queue.value[0].origin, 'from_scorecard')
    assert.match(queue.value[0].title, /Red metric: Calls/)

    // GUARD-HOIST PIN (ticket-23 review): a push rejected on the meeting
    // (concluded) persists NO issue — the guard precedes creation.
    sqliteExec(sqlite, `UPDATE meetings SET status = 'concluded' WHERE id = ${started.value.id}`)
    const redAgain = await setEntry(db, token, metric.value.id, monday, 4) // red again
    if (!redAgain.ok) throw new Error('entry fixture failed')
    assert.deepEqual(await pushRedCell(db, token, started.value.id, redAgain.value.id), {
      ok: false,
      error: 'meeting_concluded',
    })
    const countAfterReject = await listMeetingIssues(db, token, started.value.id)
    if (!countAfterReject.ok) throw new Error('list failed')
    assert.equal(countAfterReject.value.length, 1) // unchanged — nothing persisted
    sqliteExec(sqlite, `UPDATE meetings SET status = 'open' WHERE id = ${started.value.id}`)

    // Fix the number to green; re-push path via issueFromScorecardEntry → not_red.
    const green = await setEntry(db, token, metric.value.id, monday, 12)
    if (!green.ok) throw new Error('entry fixture failed')
    assert.deepEqual(await pushRedCell(db, token, started.value.id, green.value.id), {
      ok: false,
      error: 'not_red',
    })
  })

  it('pushOffTrackRock: off-track rock queues from_rock issue with rock source; on-track rejected (not_off_track)', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    const started = await startMeeting(db, token)
    if (!started.ok) throw new Error('start failed')
    const owner = await personFor(db, token, 'Alice')
    const quarterRow = sqlite
      .prepare("SELECT id FROM quarters WHERE start_date <= ? AND end_date >= ?")
      .get(todayIso(), todayIso()) as { id: number }
    const rock = await createRock(db, token, {
      statement: 'Ship the thing',
      ownerPersonId: owner.id,
      quarterId: quarterRow.id,
    })
    if (!rock.ok) throw new Error('rock fixture failed')

    // On-track (no status yet) → not_off_track.
    assert.deepEqual(await pushOffTrackRock(db, token, started.value.id, rock.value.id), {
      ok: false,
      error: 'not_off_track',
    })
    // Mark off-track; now pushable with origin + source pinned.
    const monday = weekStart(todayIso())
    assert.equal(
      (await setStatus(db, token, rock.value.id, monday, { status: 'off_track' })).ok,
      true,
    )
    const pushed = await pushOffTrackRock(db, token, started.value.id, rock.value.id)
    assert.equal(pushed.ok, true)
    const queue = await listMeetingIssues(db, token, started.value.id)
    if (!queue.ok) throw new Error('list failed')
    assert.equal(queue.value[0].origin, 'from_rock')
    assert.match(queue.value[0].title, /Goal off track: Ship the thing/)
    // Provenance pinned to the exact source rock (via the issues table read).
    const src = sqlite
      .prepare('SELECT origin_source_id FROM issues WHERE id = ?')
      .get(queue.value[0].issueId) as { origin_source_id: number }
    assert.equal(src.origin_source_id, rock.value.id)
  })

  it('pushMissedTodo: open/dropped todo queues from_todo issue; done todo rejected (todo_not_missed)', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    const started = await startMeeting(db, token)
    if (!started.ok) throw new Error('start failed')
    const assignee = await personFor(db, token, 'Assignee')
    const openTodo = await createTodo(db, token, { title: 'Send invoice', assigneePersonId: assignee.id })
    const doneTodo = await createTodo(db, token, { title: 'Filed taxes', assigneePersonId: assignee.id })
    if (!openTodo.ok || !doneTodo.ok) throw new Error('fixture failed')
    assert.equal((await completeTodo(db, token, doneTodo.value.id)).ok, true)

    // Done → todo_not_missed (ticket 20 guard, through the push helper).
    assert.deepEqual(await pushMissedTodo(db, token, started.value.id, doneTodo.value.id), {
      ok: false,
      error: 'todo_not_missed',
    })
    // Open → queues with origin + source.
    const pushed = await pushMissedTodo(db, token, started.value.id, openTodo.value.id)
    assert.equal(pushed.ok, true)
    const queue = await listMeetingIssues(db, token, started.value.id)
    if (!queue.ok) throw new Error('list failed')
    assert.equal(queue.value[0].origin, 'from_todo')
    const src = sqlite
      .prepare('SELECT origin_source_id FROM issues WHERE id = ?')
      .get(queue.value[0].issueId) as { origin_source_id: number }
    assert.equal(src.origin_source_id, openTodo.value.id)
  })

  it('pushHeadline: typed text becomes a manual issue in the queue; empty title rejected', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const started = await startMeeting(db, token)
    if (!started.ok) throw new Error('start failed')
    assert.deepEqual(await pushHeadline(db, token, started.value.id, '   '), {
      ok: false,
      error: 'title_required',
    })
    const pushed = await pushHeadline(db, token, started.value.id, 'New hire starts Monday')
    assert.equal(pushed.ok, true)
    const queue = await listMeetingIssues(db, token, started.value.id)
    if (!queue.ok) throw new Error('list failed')
    assert.equal(queue.value.length, 1)
    assert.equal(queue.value[0].title, 'New hire starts Monday')
    assert.equal(queue.value[0].origin, 'manual')
  })

  it('removeMeetingIssue: unqueues (issue persists); only in_ids rows; concluded meeting guarded', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    const started = await startMeeting(db, token)
    if (!started.ok) throw new Error('start failed')
    const issue = await addIssue(db, token, { title: 'queued then freed', classification: 'long_term' })
    if (!issue.ok) throw new Error('fixture failed')
    assert.equal((await pushToMeeting(db, token, started.value.id, issue.value.id)).ok, true)

    // Concluded meeting: removal guarded.
    sqliteExec(sqlite, `UPDATE meetings SET status = 'concluded' WHERE id = ${started.value.id}`)
    assert.deepEqual(await removeMeetingIssue(db, token, started.value.id, issue.value.id), {
      ok: false,
      error: 'meeting_concluded',
    })
    sqliteExec(sqlite, `UPDATE meetings SET status = 'open' WHERE id = ${started.value.id}`)

    const removed = await removeMeetingIssue(db, token, started.value.id, issue.value.id)
    assert.equal(removed.ok, true)
    const queue = await listMeetingIssues(db, token, started.value.id)
    if (!queue.ok) throw new Error('list failed')
    assert.equal(queue.value.length, 0)
    // The issue itself persists (issues are never deleted).
    const still = sqlite.prepare('SELECT COUNT(*) c FROM issues WHERE id = ?').get(issue.value.id) as { c: number }
    assert.equal(still.c, 1)
    // Removing a non-queued issue → issue_not_in_queue.
    assert.deepEqual(await removeMeetingIssue(db, token, started.value.id, issue.value.id), {
      ok: false,
      error: 'issue_not_in_queue',
    })
  })

  it('unknown meeting: push/list/remove all rejected (meeting_not_found)', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const issue = await addIssue(db, token, { title: 'x', classification: 'long_term' })
    if (!issue.ok) throw new Error('fixture failed')
    assert.deepEqual(await pushToMeeting(db, token, 9999, issue.value.id), {
      ok: false,
      error: 'meeting_not_found',
    })
    assert.deepEqual(await listMeetingIssues(db, token, 9999), {
      ok: false,
      error: 'meeting_not_found',
    })
    assert.deepEqual(await removeMeetingIssue(db, token, 9999, issue.value.id), {
      ok: false,
      error: 'meeting_not_found',
    })
  })
})

describe('IDS: pull long-term issues + solve in-session (seam, ticket 24)', () => {
  it('pull round-trip: long-term unresolved pulled; resolved/short-term rejected; duplicate idempotent; bulk results pinned', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const started = await startMeeting(db, token)
    if (!started.ok) throw new Error('start failed')

    const lt = await addIssue(db, token, { title: 'long', classification: 'long_term' })
    const st = await addIssue(db, token, { title: 'short', classification: 'short_term' })
    const res = await addIssue(db, token, { title: 'resolved', classification: 'long_term' })
    if (!lt.ok || !st.ok || !res.ok) throw new Error('fixture failed')
    assert.equal(
      (await resolveIssue(db, token, res.value.id, { outcome: 'solved', note: 'before' })).ok,
      true,
    )

    // Bulk: the good one pulls; short_term and resolved reject inline.
    const bulk = await pullLongTermIssues(db, token, started.value.id, [
      lt.value.id,
      st.value.id,
      res.value.id,
    ])
    assert.equal(bulk.ok, true)
    if (!bulk.ok) throw new Error('bulk failed')
    assert.deepEqual(bulk.value, [
      { issueId: lt.value.id, ok: true, meetingIssueId: bulk.value[0]!.meetingIssueId, alreadyQueued: false },
      { issueId: st.value.id, ok: false, error: 'issue_not_long_term' },
      { issueId: res.value.id, ok: false, error: 'issue_resolved' },
    ])

    // Duplicate pull of the good one: idempotent alreadyQueued, no second row.
    const dup = await pullLongTermIssues(db, token, started.value.id, [lt.value.id])
    assert.equal(dup.ok, true)
    if (!dup.ok) throw new Error('dup failed')
    assert.equal(dup.value[0]?.alreadyQueued, true)
    assert.equal(dup.value[0]?.meetingIssueId, bulk.value[0]?.meetingIssueId)
    const queue = await listMeetingIssues(db, token, started.value.id)
    if (!queue.ok) throw new Error('queue failed')
    assert.equal(queue.value.length, 1)
  })

  it('solve round-trip: state flips, resolution row has note + meeting link, to-dos carry source_meeting_id + 7-day due', async () => {
    const { db } = await createTestDb()
    const { token, user } = await signedInUser(db)
    const started = await startMeeting(db, token)
    if (!started.ok) throw new Error('start failed')
    const alice = await personFor(db, token, 'Alice')
    const issue = await addIssue(db, token, { title: 'ids problem', classification: 'long_term' })
    if (!issue.ok) throw new Error('fixture failed')
    const pulled = await pushToMeeting(db, token, started.value.id, issue.value.id)
    if (!pulled.ok) throw new Error('push failed')

    const solved = await solveMeetingIssue(db, token, started.value.id, pulled.value.meetingIssueId, {
      note: 'We decided: split the work',
      todos: [
        { title: 'do the thing', assigneePersonId: alice.id },
        { title: 'follow up', assigneePersonId: alice.id },
      ],
    })
    assert.equal(solved.ok, true)
    if (!solved.ok) throw new Error('solve failed')
    assert.equal(solved.value.issueId, issue.value.id)
    assert.equal(solved.value.todoIds.length, 2)

    // Queue row flipped to solved_today.
    const queue = await listMeetingIssues(db, token, started.value.id)
    if (!queue.ok) throw new Error('queue failed')
    assert.equal(queue.value[0]?.state, 'solved_today')

    // Resolution row: note + meeting link + write-once uniqueness.
    const resRow = await db
      .select()
      .from(issueResolutions)
      .where(eq(issueResolutions.issueId, issue.value.id))
      .get()
    assert.equal(resRow?.outcome, 'solved')
    assert.equal(resRow?.note, 'We decided: split the work')
    assert.equal(resRow?.meetingId, started.value.id)
    assert.equal(resRow?.resolvedBy, user.id)

    // To-dos: source_meeting_id + assignee + fixed 7-day due.
    const created = await db
      .select()
      .from(todosTable)
      .where(eq(todosTable.sourceMeetingId, started.value.id))
      .all()
    assert.equal(created.length, 2)
    assert.deepEqual(
      created.map((t) => t.assigneePersonId),
      [alice.id, alice.id],
    )
    // 7-day due: due_date = dueDateFrom(today) — the shared fixed rule.
    assert.equal(created[0]?.dueDate, dueDateFrom(todayIso()))
    assert.equal(created[1]?.dueDate, dueDateFrom(todayIso()))
  })

  it('solve guards: non-in_ids rejected; concluded meeting rejected; empty note rejected; double-solve rejected write-once', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    const started = await startMeeting(db, token)
    if (!started.ok) throw new Error('start failed')
    const issue = await addIssue(db, token, { title: 'x', classification: 'long_term' })
    if (!issue.ok) throw new Error('fixture failed')
    const pulled = await pushToMeeting(db, token, started.value.id, issue.value.id)
    if (!pulled.ok) throw new Error('push failed')

    // Empty note → resolveIssue's note_required (surfaced through the seam).
    assert.deepEqual(
      await solveMeetingIssue(db, token, started.value.id, pulled.value.meetingIssueId, {
        note: '',
        todos: [],
      }),
      { ok: false, error: 'note_required' },
    )

    const ok = await solveMeetingIssue(db, token, started.value.id, pulled.value.meetingIssueId, {
      note: 'done',
      todos: [],
    })
    assert.equal(ok.ok, true)

    // Double-solve: the row is solved_today → issue_not_in_queue; the
    // write-once resolution underneath is what makes a second solve impossible.
    assert.deepEqual(
      await solveMeetingIssue(db, token, started.value.id, pulled.value.meetingIssueId, {
        note: 'again',
        todos: [],
      }),
      { ok: false, error: 'issue_not_in_queue' },
    )
    // CRASH-WINDOW PIN (ticket-24 review): simulate the documented crash —
    // resolution exists but the queue row lags in in_ids. A second solve
    // must be rejected by the write-once resolution AND the row must stay
    // in_ids (ticket 25's conclude handles lingering in_ids as carried).
    const crashRow = pulled.value.meetingIssueId
    sqliteExec(sqlite, `UPDATE meeting_issues SET state = 'in_ids' WHERE id = ${crashRow}`)
    assert.deepEqual(
      await solveMeetingIssue(db, token, started.value.id, crashRow, { note: 'crash retry', todos: [] }),
      { ok: false, error: 'already_resolved' },
    )
    const laggedList = await listMeetingIssues(db, token, started.value.id)
    assert.equal(laggedList.ok, true)
    if (!laggedList.ok) throw new Error('list failed')
    const lagged = laggedList.value.find((r) => r.meetingIssueId === crashRow)
    assert.equal(lagged?.state, 'in_ids')

    // Concluded meeting guard.
    sqliteExec(sqlite, `UPDATE meetings SET status = 'concluded' WHERE id = ${started.value.id}`)
    assert.deepEqual(
      await solveMeetingIssue(db, token, started.value.id, pulled.value.meetingIssueId, {
        note: 'post-conclude',
        todos: [],
      }),
      { ok: false, error: 'meeting_concluded' },
    )
  })

  it('unknown ids rejected; unauthenticated denied; member participates', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const member = await signedInUser(db, 'member')
    const started = await startMeeting(db, token)
    if (!started.ok) throw new Error('start failed')
    const issue = await addIssue(db, token, { title: 'x', classification: 'long_term' })
    if (!issue.ok) throw new Error('fixture failed')

    // Unknown meeting-issue id.
    assert.deepEqual(
      await solveMeetingIssue(db, token, started.value.id, 9999, { note: 'n', todos: [] }),
      { ok: false, error: 'issue_not_in_queue' },
    )
    // Unknown issue id in a bulk pull.
    const pull = await pullLongTermIssues(db, token, started.value.id, [issue.value.id, 424242])
    assert.equal(pull.ok, true)
    if (!pull.ok) throw new Error('pull failed')
    assert.equal(pull.value[0]?.ok, true)
    assert.equal(pull.value[1]?.ok, false)
    assert.equal(pull.value[1]?.error, 'issue_not_found')

    // Unauthenticated denied on both.
    assert.equal((await pullLongTermIssues(db, undefined, started.value.id, [])).ok, false)
    assert.equal(
      (await solveMeetingIssue(db, undefined, started.value.id, 1, { note: 'n', todos: [] })).ok,
      false,
    )

    // Member (any participant) can pull and solve.
    const memberPull = await pullLongTermIssues(db, member.token, started.value.id, [issue.value.id])
    assert.equal(memberPull.ok, true)
    if (!memberPull.ok) throw new Error('member pull failed')
    assert.equal(memberPull.value[0]?.alreadyQueued, true)
  })
})

describe('Conclude, ratings & frozen archive (seam, ticket 25)', () => {
  it('conclude round-trip: in_ids → carried, solved_today untouched, crash-window rows carried but issue stays solved', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const started = await startMeeting(db, token)
    if (!started.ok) throw new Error('start failed')
    // Three queue rows: plain in_ids; solved_today; crash-window (in_ids + resolved).
    const i1 = await addIssue(db, token, { title: 'plain', classification: 'long_term' })
    const i2 = await addIssue(db, token, { title: 'solved in room', classification: 'long_term' })
    const i3 = await addIssue(db, token, { title: 'crash window', classification: 'long_term' })
    if (!i1.ok || !i2.ok || !i3.ok) throw new Error('fixture failed')
    assert.equal((await pushToMeeting(db, token, started.value.id, i1.value.id)).ok, true)
    assert.equal((await pushToMeeting(db, token, started.value.id, i2.value.id)).ok, true)
    assert.equal((await pushToMeeting(db, token, started.value.id, i3.value.id)).ok, true)
    // Solve i2 properly to get solved_today.
    const queueBefore = await listMeetingIssues(db, token, started.value.id)
    if (!queueBefore.ok) throw new Error('list failed')
    const rows = queueBefore.value
    const rowFor = (issueId: number) => rows.find((r) => r.issueId === issueId)!
    assert.equal(
      (await solveMeetingIssue(db, token, started.value.id, rowFor(i2.value.id).meetingIssueId, { note: 'done', todos: [] }))
        .ok,
      true,
    )
    // Crash window: resolve i3 directly (bypassing the queue flip).
    assert.equal((await resolveIssue(db, token, i3.value.id, { outcome: 'solved', note: 'crashed' })).ok, true)

    const concluded = await concludeMeeting(db, token, started.value.id)
    assert.equal(concluded.ok, true)
    if (!concluded.ok) throw new Error('conclude failed')
    assert.equal(concluded.value.carriedCount, 2) // plain + crash-window rows

    // Meeting frozen.
    const read = await getMeeting(db, token, started.value.id)
    assert.equal(read.ok, true)
    if (!read.ok) throw new Error('read failed')
    assert.equal(read.value.status, 'concluded')
    assert.equal(read.value.concludedAt != null, true)

    // Queue states: in_ids → carried; solved_today UNTOUCHED (rowFor reads
    // the FRESH post-conclude list — the pre-conclude snapshot is stale).
    const queueAfter = await listMeetingIssues(db, token, started.value.id)
    if (!queueAfter.ok) throw new Error('list failed')
    const freshRowFor = (issueId: number) => queueAfter.value.find((r) => r.issueId === issueId)!
    assert.equal(freshRowFor(i1.value.id).state, 'carried')
    assert.equal(freshRowFor(i2.value.id).state, 'solved_today')
    assert.equal(freshRowFor(i3.value.id).state, 'carried')

    // Crash-window issue STILL solved (resolution exists).
    const crashRes = await db
      .select()
      .from(issueResolutions)
      .where(eq(issueResolutions.issueId, i3.value.id))
      .get()
    assert.equal(crashRes?.outcome, 'solved')

    // Unresolved carried issue is on the long-term list (keep-row: no action needed).
    const longList = await listIssues(db, token, { classification: 'long_term' })
    if (!longList.ok) throw new Error('list failed')
    assert.ok(longList.value.some((i) => i.id === i1.value.id && i.status === 'open'))
  })

  it('post-conclude immutability: advance/notes/push/solve/facilitator/delete ALL rejected', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    const started = await startMeeting(db, token)
    if (!started.ok) throw new Error('start failed')
    const issue = await addIssue(db, token, { title: 'queued', classification: 'long_term' })
    if (!issue.ok) throw new Error('fixture failed')
    assert.equal((await pushToMeeting(db, token, started.value.id, issue.value.id)).ok, true)
    assert.equal((await concludeMeeting(db, token, started.value.id)).ok, true)
    const meetingRead = await getMeeting(db, token, started.value.id)
    assert.equal(meetingRead.ok, true)
    if (!meetingRead.ok) throw new Error('read failed')
    const segs = meetingRead.value.segments
    const activeSeg = segs.find((s) => s.active) ?? segs[0]

    assert.deepEqual(await advanceSegment(db, token, started.value.id, activeSeg.id), {
      ok: false,
      error: 'meeting_concluded',
    })
    assert.deepEqual(await saveSegmentNotes(db, token, started.value.id, activeSeg.id, 'typo fix'), {
      ok: false,
      error: 'meeting_concluded',
    })
    assert.deepEqual(await pushToMeeting(db, token, started.value.id, issue.value.id), {
      ok: false,
      error: 'meeting_concluded',
    })
    assert.deepEqual(await solveMeetingIssue(db, token, started.value.id, issue.value.id, { note: 'n', todos: [] }), {
      ok: false,
      error: 'meeting_concluded',
    })
    assert.deepEqual(await setFacilitator(db, token, started.value.id, null), {
      ok: false,
      error: 'meeting_concluded',
    })
    assert.deepEqual(await deleteMeeting(db, token, started.value.id), {
      ok: false,
      error: 'meeting_concluded',
    })
    // Advance of the conclude segment still explicit-rejects (conclude_explicit).
    const concludeSeg = segs.find((s) => s.segmentKey === 'conclude')!
    assert.deepEqual(await advanceSegment(db, token, started.value.id, concludeSeg.id), {
      ok: false,
      error: 'meeting_concluded',
    })
    // Pull and remove are also frozen post-conclude (review P2 — the two
    // queue ops the ticket-25 freeze test initially omitted).
    const pulledIssue = await addIssue(db, token, { title: 'post-conclude pull', classification: 'long_term' })
    if (!pulledIssue.ok) throw new Error('fixture failed')
    assert.deepEqual(await pullLongTermIssues(db, token, started.value.id, [pulledIssue.value.id]), {
      ok: false,
      error: 'meeting_concluded',
    })
    assert.deepEqual(await removeMeetingIssue(db, token, started.value.id, issue.value.id), {
      ok: false,
      error: 'meeting_concluded',
    })
    void sqlite
  })

  it('setRating: round-trip + overwrite; boundaries 1/10 valid, 0/11 rejected; person_required for unlinked; unauth denied', async () => {
    const { db } = await createTestDb()
    const { token, user } = await signedInUser(db) // unlinked admin fixture
    const started = await startMeeting(db, token)
    if (!started.ok) throw new Error('start failed')
    const alice = await personFor(db, token, 'Alice')
    // Link the admin to a person so they can rate.
    assert.equal((await linkUserToPerson(db, token, user.id, alice.id)).ok, true)

    // Unlinked accounts can't rate.
    const member = await signedInUser(db, 'member')
    assert.deepEqual(await setRating(db, member.token, started.value.id, 7), {
      ok: false,
      error: 'person_required',
    })

    // Boundary pins: 0 and 11 rejected; 1 and 10 valid.
    assert.deepEqual(await setRating(db, token, started.value.id, 0), { ok: false, error: 'invalid_score' })
    assert.deepEqual(await setRating(db, token, started.value.id, 11), { ok: false, error: 'invalid_score' })
    assert.deepEqual(await setRating(db, token, started.value.id, 3.5), { ok: false, error: 'invalid_score' })
    const low = await setRating(db, token, started.value.id, 1)
    assert.equal(low.ok, true)
    const high = await setRating(db, token, started.value.id, 10)
    assert.equal(high.ok, true)
    if (!high.ok) throw new Error('rating failed')
    assert.deepEqual(high.value.ratings, [{ personId: alice.id, personName: 'Alice', score: 10 }])
    assert.equal(high.value.avgRating, 10) // overwrite, one row

    // Unauthenticated denied.
    assert.equal((await setRating(db, undefined, started.value.id, 7)).ok, false)
    // Unknown meeting.
    assert.deepEqual(await setRating(db, token, 99999, 7), { ok: false, error: 'meeting_not_found' })
  })

  it('conclude guards: already-concluded rejected; unknown meeting; rating on concluded meeting allowed (documented delta)', async () => {
    const { db } = await createTestDb()
    const { token, user } = await signedInUser(db)
    const alice = await personFor(db, token, 'Alice')
    const started = await startMeeting(db, token)
    if (!started.ok) throw new Error('start failed')
    assert.deepEqual(await concludeMeeting(db, token, 99999), { ok: false, error: 'meeting_not_found' })
    assert.equal((await concludeMeeting(db, token, started.value.id)).ok, true)
    assert.deepEqual(await concludeMeeting(db, token, started.value.id), {
      ok: false,
      error: 'meeting_concluded',
    })

    // The documented delta: ratings remain writable post-conclude.
    assert.equal((await linkUserToPerson(db, token, user.id, alice.id)).ok, true)
    const late = await setRating(db, token, started.value.id, 8)
    assert.equal(late.ok, true)
    if (!late.ok) throw new Error('late rating failed')
    assert.equal(late.value.avgRating, 8)
  })

  it('recap: new to-dos listed with assignees; cascading messages = conclude segment notes; carried count', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    const started = await startMeeting(db, token)
    if (!started.ok) throw new Error('start failed')
    const alice = await personFor(db, token, 'Alice')
    const issue = await addIssue(db, token, { title: 'to solve', classification: 'long_term' })
    if (!issue.ok) throw new Error('fixture failed')
    assert.equal((await pushToMeeting(db, token, started.value.id, issue.value.id)).ok, true)
    const queue = await listMeetingIssues(db, token, started.value.id)
    if (!queue.ok) throw new Error('list failed')
    const solved = await solveMeetingIssue(db, token, started.value.id, queue.value[0].meetingIssueId, {
      note: 'split it',
      todos: [{ title: 'do A', assigneePersonId: alice.id }],
    })
    assert.equal(solved.ok, true)

    // Cascading messages via the conclude segment's notes (documented storage).
    const meetingRead = await getMeeting(db, token, started.value.id)
    assert.equal(meetingRead.ok, true)
    if (!meetingRead.ok) throw new Error('read failed')
    const concludeSeg = meetingRead.value.segments.find((s) => s.segmentKey === 'conclude')!
    assert.equal((await saveSegmentNotes(db, token, started.value.id, concludeSeg.id, 'tell the team X')).ok, true)

    assert.equal((await concludeMeeting(db, token, started.value.id)).ok, true)
    const recap = await listMeetingRecap(db, token, started.value.id)
    assert.equal(recap.ok, true)
    if (!recap.ok) throw new Error('recap failed')
    assert.equal(recap.value.newTodos.length, 1)
    assert.equal(recap.value.newTodos[0]?.title, 'do A')
    assert.equal(recap.value.newTodos[0]?.assigneeName, 'Alice')
    assert.equal(recap.value.carriedCount, 0) // the only queue row was solved_today
    assert.deepEqual(recap.value.ratings, [])
    assert.equal(recap.value.avgRating, null)
    assert.equal(recap.value.cascadingMessages, 'tell the team X')
    void sqlite
  })

  it('ratingTrend: pinned averages (7,9 → 8.0; unrated → null), oldest→newest', async () => {
    const { db } = await createTestDb()
    const { token, user } = await signedInUser(db)
    const alice = await personFor(db, token, 'Alice')
    assert.equal((await linkUserToPerson(db, token, user.id, alice.id)).ok, true)

    const m1 = await startMeeting(db, token)
    if (!m1.ok) throw new Error('start failed')
    // Two raters on meeting 1: 7 and 9 → 8.0. (member rates via linked person)
    const member = await signedInUser(db, 'member')
    const bob = await personFor(db, token, 'Bob')
    assert.equal((await linkUserToPerson(db, token, member.user.id, bob.id)).ok, true)
    assert.equal((await setRating(db, token, m1.value.id, 7)).ok, true)
    assert.equal((await setRating(db, member.token, m1.value.id, 9)).ok, true)
    assert.equal((await concludeMeeting(db, token, m1.value.id)).ok, true)

    // Meeting 2: one rater, 6 → 6.0.
    const m2 = await startMeeting(db, token)
    if (!m2.ok) throw new Error('start failed')
    assert.equal((await setRating(db, token, m2.value.id, 6)).ok, true)
    assert.equal((await concludeMeeting(db, token, m2.value.id)).ok, true)

    // Meeting 3: open + unrated → null.
    const m3 = await startMeeting(db, token)
    if (!m3.ok) throw new Error('start failed')

    const trend = await ratingTrend(db, token)
    assert.equal(trend.ok, true)
    if (!trend.ok) throw new Error('trend failed')
    assert.equal(trend.value.length, 3)
    assert.deepEqual(
      trend.value.map((t) => t.avgRating),
      [8, 6, null],
    )
    assert.equal(trend.value[0]?.status, 'concluded')
    assert.equal(trend.value[2]?.status, 'open')
  })
})
