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
  SEGMENT_AGENDA,
} from '../src/server/meetings'
import { createPerson, linkUserToPerson } from '../src/server/people'
import { setEntry, createMetric } from '../src/server/metrics'
import { createRock, setStatus } from '../src/server/rocks'
import { createTodo, completeTodo } from '../src/server/todos'
import { addIssue, resolveIssue } from '../src/server/issues'
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
    const { db } = await createTestDb()
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
    assert.match(queue.value[0].title, /Rock off track: Ship the thing/)
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
