import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  addIssue,
  updateIssue,
  resolveIssue,
  listIssues,
  ageWeeksSince,
  issueFromRock,
  issueFromScorecardEntry,
  issueFromTodo,
  listUnresolvedForCarry,
  carryLongTermIssue,
  carryUnresolvedLongTermIssues,
} from '../src/server/issues'
import { getCurrentQuarter } from '../src/server/quarters'
import { quarters } from '../src/server/schema'
import { createTestDb, signedInUser } from './helpers'
import { todayIso, weekStart } from '../src/server/week'
import { createTodo, completeTodo } from '../src/server/todos'
import { createPerson } from '../src/server/people'

/** Test fixture: create a person and return the row. */
async function personFor(
  db: Parameters<typeof createTodo>[0],
  token: string,
  name: string,
) {
  const result = await createPerson(db, token, { fullName: name })
  if (!result.ok) throw new Error('person fixture failed')
  return result.value
}

/** Pins the week-aligned age math across month/year/leap boundaries. */
describe('ageWeeksSince (pure regression guard — pinned literal cases)', () => {
  it('counts Monday boundaries crossed since the added week', () => {
    assert.equal(ageWeeksSince('2026-03-10', '2026-03-25'), 2) // Tue → Wed, 2 weeks
    assert.equal(ageWeeksSince('2026-03-24', '2026-03-25'), 0) // same week
    assert.equal(ageWeeksSince('2026-03-23', '2026-03-30'), 1) // Mon → next Mon
    assert.equal(ageWeeksSince('2026-04-06', '2026-03-30'), -1) // a full week ahead
    assert.equal(ageWeeksSince('2026-02-24', '2026-03-25'), 4) // month boundary
    assert.equal(ageWeeksSince('2025-12-30', '2026-03-25'), 12) // year boundary
    assert.equal(ageWeeksSince('2024-02-27', '2024-03-26'), 4) // leap year
    // Week-alignment discriminator: Fri → Mon crosses a Monday boundary with
    // only 3 elapsed days — a naive floor(days/7) bucket would say 0.
    assert.equal(ageWeeksSince('2026-03-13', '2026-03-16'), 1)
  })
})

describe('Issues: core lists (seam, ticket 16)', () => {
  it('add round-trip: long_term defaults to the current quarter; origin=manual', async () => {
    const { db } = await createTestDb()
    const { token, user } = await signedInUser(db)
    const result = await addIssue(db, token, {
      title: '  Fix the billing page  ',
      classification: 'long_term',
    })
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.value.title, 'Fix the billing page')
      assert.equal(result.value.classification, 'long_term')
      assert.equal(result.value.origin, 'manual')
      assert.equal(result.value.originSourceId, null)
      assert.equal(result.value.createdBy, user.id)
      assert.equal(result.value.sortOrder, 0)
      const current = await getCurrentQuarter(db)
      assert.equal(result.value.quarterId, current?.id)
    }
  })

  it('add round-trip: short_term has no quarter; explicit quarter rules pinned', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const short = await addIssue(db, token, {
      title: 'Ship the release notes',
      classification: 'short_term',
    })
    assert.equal(short.ok, true)
    if (short.ok) assert.equal(short.value.quarterId, null)

    // Short-term with a quarter → rejected (week context, not quarter).
    const quarterRows = await db.select().from(quarters).all()
    assert.deepEqual(
      await addIssue(db, token, {
        title: 'x',
        classification: 'short_term',
        quarterId: quarterRows[0].id,
      }),
      { ok: false, error: 'quarter_not_allowed' },
    )
    // Long-term with an unknown quarter → rejected.
    assert.deepEqual(
      await addIssue(db, token, { title: 'x', classification: 'long_term', quarterId: 9999 }),
      { ok: false, error: 'quarter_not_found' },
    )
    // Empty title and bad classification rejected.
    assert.deepEqual(await addIssue(db, token, { title: '  ', classification: 'long_term' }), {
      ok: false,
      error: 'title_required',
    })
    assert.deepEqual(
      await addIssue(db, token, { title: 'x', classification: 'bogus' as 'long_term' }),
      { ok: false, error: 'classification_required' },
    )
  })

  it('resolve round-trip: derived status, write-once, notes required for both outcomes', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const a = await addIssue(db, token, { title: 'A', classification: 'short_term' })
    const b = await addIssue(db, token, { title: 'B', classification: 'short_term' })
    const c = await addIssue(db, token, { title: 'C', classification: 'short_term' })
    if (!a.ok || !b.ok || !c.ok) throw new Error('fixture failed')

    // Open by default.
    const before = await listIssues(db, token, { classification: 'short_term' })
    if (before.ok) assert.equal(before.value.every((i) => i.status === 'open'), true)

    // Empty notes rejected for both outcomes.
    assert.deepEqual(
      await resolveIssue(db, token, a.value.id, { outcome: 'solved', note: '  ' }),
      { ok: false, error: 'note_required' },
    )
    assert.deepEqual(
      await resolveIssue(db, token, b.value.id, { outcome: 'dropped', note: '' }),
      { ok: false, error: 'note_required' },
    )
    // Bad outcome string rejected.
    assert.deepEqual(
      await resolveIssue(db, token, a.value.id, {
        outcome: 'maybe' as 'solved',
        note: 'n',
      }),
      { ok: false, error: 'note_required' },
    )

    // Solve A, drop B.
    const solved = await resolveIssue(db, token, a.value.id, {
      outcome: 'solved',
      note: 'Switched to the new provider',
    })
    assert.equal(solved.ok, true)
    if (solved.ok) {
      assert.equal(solved.value.outcome, 'solved')
      assert.equal(solved.value.note, 'Switched to the new provider')
   }
    const dropped = await resolveIssue(db, token, b.value.id, {
      outcome: 'dropped',
      note: 'Provider fixed it themselves',
    })
    assert.equal(dropped.ok, true)
    if (dropped.ok) assert.equal(dropped.value.outcome, 'dropped')

    // Write-once: second resolution rejected.
    assert.deepEqual(
      await resolveIssue(db, token, a.value.id, { outcome: 'dropped', note: 'again' }),
      { ok: false, error: 'already_resolved' },
    )
    // Unknown issue rejected.
    assert.deepEqual(
      await resolveIssue(db, token, 9999, { outcome: 'solved', note: 'n' }),
      { ok: false, error: 'not_found' },
    )

    // Derived status from resolution rows (issue rows never mutated).
    const after = await listIssues(db, token, { classification: 'short_term', includeResolved: true })
    assert.equal(after.ok, true)
    if (after.ok) {
      const byId = new Map(after.value.map((i) => [i.id, i]))
      assert.equal(byId.get(a.value.id)?.status, 'solved')
      assert.equal(byId.get(b.value.id)?.status, 'dropped')
      assert.equal(byId.get(c.value.id)?.status, 'open')
   }
  })

  it('list: unresolved first, sort_order then created_at ordering, age pinned via seeded created_at', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    const i1 = await addIssue(db, token, { title: 'first', classification: 'long_term' })
    const i2 = await addIssue(db, token, { title: 'second', classification: 'long_term' })
    const i3 = await addIssue(db, token, { title: 'third', classification: 'long_term' })
    if (!i1.ok || !i2.ok || !i3.ok) throw new Error('fixture failed')
    // Manual sort_order: 'third' jumps the queue; 'first'/'second' tie on 0
    // and fall back to created_at.
    sqlite.exec(`UPDATE issues SET sort_order = 1 WHERE id = ${i3.value.id}`)
    // Re-anchor created_at for a pinned age: added exactly 2 Monday-weeks
    // before today (Monday-anchored so the pin holds on any run day).
    const twoWeeksAgoMonday = new Date(
      Date.parse(weekStart(todayIso())) - 14 * 86400000,
    ).toISOString()
    sqlite.exec(`UPDATE issues SET created_at = '${twoWeeksAgoMonday}' WHERE id = ${i1.value.id}`)

    const result = await listIssues(db, token, { classification: 'long_term' })
    assert.equal(result.ok, true)
    if (result.ok) {
      // sort_order 0 rows first (created_at tie-break), then sort_order 1.
      assert.deepEqual(
        result.value.map((i) => i.title),
        ['first', 'second', 'third'],
      )
      // Pinned age: 'first' was re-anchored ~2 weeks back.
      const first = result.value.find((i) => i.title === 'first')
      assert.equal(first?.ageWeeks, 2)
      assert.equal(first?.addedByName, null) // admin fixture is unlinked
    }
  })

  it('list: includeResolved toggle and classification filter', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const a = await addIssue(db, token, { title: 'short', classification: 'short_term' })
    const b = await addIssue(db, token, { title: 'long', classification: 'long_term' })
    if (!a.ok || !b.ok) throw new Error('fixture failed')
    assert.equal((await resolveIssue(db, token, a.value.id, { outcome: 'solved', note: 'done' })).ok, true)

    // Default: open only.
    const open = await listIssues(db, token)
    assert.equal(open.ok, true)
    if (open.ok) {
      assert.deepEqual(open.value.map((i) => i.title), ['long'])
      // Age data present and sane.
      assert.equal(typeof open.value[0].ageWeeks, 'number')
   }

    // includeResolved brings the solved row back, sorted after open.
    const all = await listIssues(db, token, { includeResolved: true })
    assert.equal(all.ok, true)
    if (all.ok) {
      assert.deepEqual(all.value.map((i) => [i.title, i.status]), [
        ['long', 'open'],
        ['short', 'solved'],
      ])
      assert.equal(all.value[1].resolution?.note, 'done')
    }

    // Classification filter.
    const longOnly = await listIssues(db, token, { classification: 'long_term' })
    if (longOnly.ok) assert.deepEqual(longOnly.value.map((i) => i.title), ['long'])
    const shortAll = await listIssues(db, token, {
      classification: 'short_term',
      includeResolved: true,
    })
    if (shortAll.ok) assert.deepEqual(shortAll.value.map((i) => i.title), ['short'])
  })

  it('update: retitle, reclassify (quarter rules re-applied), resolved issues locked', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const issue = await addIssue(db, token, {
      title: 'Original',
      classification: 'long_term',
    })
    if (!issue.ok) throw new Error('fixture failed')
    const originalQuarterId = issue.value.quarterId

    // Retitle.
    const retitled = await updateIssue(db, token, issue.value.id, { title: 'Renamed' })
    assert.equal(retitled.ok, true)
    if (retitled.ok) {
      assert.equal(retitled.value.title, 'Renamed')
      assert.equal(retitled.value.quarterId, originalQuarterId) // same classification keeps quarter
    }

    // Reclassify to short_term → quarter cleared.
    const toShort = await updateIssue(db, token, issue.value.id, {
      classification: 'short_term',
    })
    assert.equal(toShort.ok, true)
    if (toShort.ok) assert.equal(toShort.value.quarterId, null)

    // Reclassify back to long_term without a quarter → current quarter default.
    const toLong = await updateIssue(db, token, issue.value.id, {
      classification: 'long_term',
    })
    assert.equal(toLong.ok, true)
    if (toLong.ok) {
      const current = await getCurrentQuarter(db)
      assert.equal(toLong.value.quarterId, current?.id)
    }

    // Once resolved, editing is rejected.
    assert.equal(
      (await resolveIssue(db, token, issue.value.id, { outcome: 'dropped', note: 'gone' })).ok,
      true,
    )
    assert.deepEqual(await updateIssue(db, token, issue.value.id, { title: 'zombie' }), {
      ok: false,
      error: 'already_resolved',
    })
    assert.deepEqual(await updateIssue(db, token, 9999, { title: 'x' }), {
      ok: false,
      error: 'not_found',
    })
  })

  it('access: members add/resolve/edit freely; unauthenticated denied everywhere', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db) // admin fixture
    const member = await signedInUser(db, 'member')
    const adminIssue = await addIssue(db, token, { title: 'admin issue', classification: 'short_term' })
    if (!adminIssue.ok) throw new Error('fixture failed')

    // Member can add, edit, resolve — team property.
    const memberIssue = await addIssue(db, member.token, {
      title: 'member issue',
      classification: 'short_term',
    })
    assert.equal(memberIssue.ok, true)
    assert.equal(
      (await updateIssue(db, member.token, adminIssue.value.id, { title: 'edited by member' }))
        .ok,
      true,
    )
    const memberResolve = await resolveIssue(db, member.token, adminIssue.value.id, {
      outcome: 'solved',
      note: 'member solved it',
    })
    assert.equal(memberResolve.ok, true)

    // Unauthenticated denials on every entry point.
    assert.deepEqual(
      await addIssue(db, undefined, { title: 'x', classification: 'long_term' }),
      { ok: false, error: 'unauthenticated' },
    )
    assert.deepEqual(await resolveIssue(db, undefined, 1, { outcome: 'solved', note: 'n' }), {
      ok: false,
      error: 'unauthenticated',
    })
    assert.deepEqual(await updateIssue(db, undefined, 1, { title: 'x' }), {
      ok: false,
      error: 'unauthenticated',
    })
    assert.deepEqual(await listIssues(db, undefined), { ok: false, error: 'unauthenticated' })
  })
})
// ================= Ticket 20: provenance + quarter-end carry =================

import { createRock } from '../src/server/rocks'
import { createMetric, setEntry } from '../src/server/metrics'
import { DatabaseSync } from 'node:sqlite'

describe('Ticket 20: issue provenance (seam)', () => {
  it('issueFromRock: origin + source id + derived title persisted; unknown rock rejected; unauth denied; member allowed', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const member = await signedInUser(db, 'member')
    const quarter = await getCurrentQuarter(db)
    if (!quarter) throw new Error('no current quarter')
    const rock = await createRock(db, token, { statement: 'Ship the L10 app', quarterId: quarter.id })
    if (!rock.ok) throw new Error('fixture failed')

    const result = await issueFromRock(db, token, rock.value.id)
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.value.origin, 'from_rock')
      assert.equal(result.value.originSourceId, rock.value.id)
      assert.equal(result.value.title, 'Goal off track: Ship the L10 app')
      assert.equal(result.value.classification, 'long_term')
    }

    // List view carries the origin for the badge.
    const list = await listIssues(db, token, { classification: 'long_term' })
    if (list.ok) assert.equal(list.value[0]?.origin, 'from_rock')

    assert.deepEqual(await issueFromRock(db, token, 999), { ok: false, error: 'not_found' })
    assert.deepEqual(await issueFromRock(db, undefined, rock.value.id), {
      ok: false,
      error: 'unauthenticated',
    })
    // Members push too (issues are team property).
    assert.equal((await issueFromRock(db, member.token, rock.value.id)).ok, true)
    // Duplicates allowed (EOS room may push twice — decided, documented).
    assert.equal((await issueFromRock(db, token, rock.value.id)).ok, true)
  })

  it('issueFromScorecardEntry: red cell derives title + origin; green cell rejected as not_red', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const person = await personFor(db, token, 'Alice')
    const metric = await createMetric(db, token, {
      name: 'Weekly closes',
      ownerPersonId: person.id,
      target: 10,
      direction: 'gte',
      unit: 'closes',
    })
    if (!metric.ok) throw new Error('fixture failed')
    // Red: actual 5 vs target 10 (gte).
    const red = await setEntry(db, token, metric.value.id, '2026-03-04', 5)
    // Green: actual 12.
    const green = await setEntry(db, token, metric.value.id, '2026-03-11', 12)
    if (!red.ok || !green.ok) throw new Error('fixture failed')

    const result = await issueFromScorecardEntry(db, token, red.value.id)
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.value.origin, 'from_scorecard')
      assert.equal(result.value.originSourceId, red.value.id)
      assert.equal(
        result.value.title,
        'Red metric: Weekly closes — Week of Mar 2: 5 vs target 10',
      )
    }
    assert.deepEqual(await issueFromScorecardEntry(db, token, green.value.id), {
      ok: false,
      error: 'not_red',
    })
    assert.deepEqual(await issueFromScorecardEntry(db, token, 999), {
      ok: false,
      error: 'not_found',
    })
    assert.deepEqual(await issueFromScorecardEntry(db, undefined, red.value.id), {
      ok: false,
      error: 'unauthenticated',
    })
  })

  it('issueFromTodo: missed to-do pushes; completed to-do rejected as todo_not_missed', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const person = await personFor(db, token, 'Bob')
    const missed = await createTodo(db, token, { title: 'Call the bank', assigneePersonId: person.id })
    const done = await createTodo(db, token, { title: 'Already done', assigneePersonId: person.id })
    if (!missed.ok || !done.ok) throw new Error('fixture failed')
    assert.equal((await completeTodo(db, token, done.value.id)).ok, true)

    const result = await issueFromTodo(db, token, missed.value.id)
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.value.origin, 'from_todo')
      assert.equal(result.value.originSourceId, missed.value.id)
      assert.equal(result.value.title, 'Missed to-do: Call the bank')
    }
    assert.deepEqual(await issueFromTodo(db, token, done.value.id), {
      ok: false,
      error: 'todo_not_missed',
    })
    assert.deepEqual(await issueFromTodo(db, token, 999), { ok: false, error: 'not_found' })
    assert.deepEqual(await issueFromTodo(db, undefined, missed.value.id), {
      ok: false,
      error: 'unauthenticated',
    })
  })
})

describe('Ticket 20: quarter-end carry-or-drop (seam)', () => {
  function seedQuarter(sqlite: DatabaseSync, label: string, endDate: string): number {
    sqlite.exec(
      `INSERT INTO quarters (label, start_date, end_date) VALUES ('${label}', date('${endDate}', '-3 months'), '${endDate}')`,
    )
    return (sqlite.prepare('SELECT id FROM quarters WHERE label = ?').get(label) as { id: number }).id
  }

  async function seedCarryFixture() {
    const { db, sqlite } = await createTestDb()
    const { token, user } = await signedInUser(db)
    const today = todayIso()
    // fromQuarter: ended yesterday. toQuarter: ends in ~9 months (not ended).
    const fromId = seedQuarter(sqlite, '2099 Q1', new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10))
    const toId = seedQuarter(sqlite, '2099 Q3', new Date(Date.parse(today) + 270 * 86400000).toISOString().slice(0, 10))
    const endsTodayId = seedQuarter(sqlite, '2099 Q2', today)
    const issuesToMake = ['u1', 'u2', 'u3', 'r1', 'r2']
    const ids: number[] = []
    for (const title of issuesToMake) {
      const r = await addIssue(db, token, { title, classification: 'long_term', quarterId: fromId })
      if (!r.ok) throw new Error('fixture failed')
      ids.push(r.value.id)
    }
    // Resolve the last two (solved + dropped).
    assert.equal((await resolveIssue(db, token, ids[3], { outcome: 'solved', note: 'done' })).ok, true)
    assert.equal((await resolveIssue(db, token, ids[4], { outcome: 'dropped', note: 'obsolete' })).ok, true)
    return { db, sqlite, token, user, fromId, toId, endsTodayId, unresolved: ids.slice(0, 3), resolved: ids.slice(3) }
  }

  it('listUnresolvedForCarry: only unresolved long-term issues in the from-quarter; signed-in readable', async () => {
    const f = await seedCarryFixture()
    const result = await listUnresolvedForCarry(f.db, f.token, f.fromId)
    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual(result.value.map((i) => i.title), ['u1', 'u2', 'u3'])
    const member = await signedInUser(f.db, 'member')
    const memberView = await listUnresolvedForCarry(f.db, member.token, f.fromId)
    assert.equal(memberView.ok, true)
  })

  it('carryUnresolvedLongTermIssues: carried=3 (resolved untouched), keep-row via quarter_id update', async () => {
    const f = await seedCarryFixture()
    const result = await carryUnresolvedLongTermIssues(f.db, f.token, f.fromId, f.toId)
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.value.carried, 3)

    // Carried rows keep their id (lean keep-row) and now point at toQuarter.
    for (const id of f.unresolved) {
      const row = f.sqlite.prepare('SELECT quarter_id FROM issues WHERE id = ?').get(id) as { quarter_id: number }
      assert.equal(row.quarter_id, f.toId)
    }
    // Resolved rows stay in the from-quarter (history).
    for (const id of f.resolved) {
      const row = f.sqlite.prepare('SELECT quarter_id FROM issues WHERE id = ?').get(id) as { quarter_id: number }
      assert.equal(row.quarter_id, f.fromId)
    }
    // Idempotent-ish: a second bulk carry carries nothing.
    const again = await carryUnresolvedLongTermIssues(f.db, f.token, f.fromId, f.toId)
    if (again.ok) assert.equal(again.value.carried, 0)
  })

  it('carry boundaries: member forbidden; unauth denied; source quarter ending today NOT carryable (strict <); target in past rejected', async () => {
    const f = await seedCarryFixture()
    const member = await signedInUser(f.db, 'member')
    assert.deepEqual(await carryUnresolvedLongTermIssues(f.db, member.token, f.fromId, f.toId), {
      ok: false,
      error: 'forbidden',
    })
    assert.deepEqual(await carryUnresolvedLongTermIssues(f.db, undefined, f.fromId, f.toId), {
      ok: false,
      error: 'unauthenticated',
    })
    // From-quarter ending today is not ended (strict <) — pin the boundary.
    assert.deepEqual(await carryUnresolvedLongTermIssues(f.db, f.token, f.endsTodayId, f.toId), {
      ok: false,
      error: 'quarter_not_ended',
    })
    // Target in the past is hidden history — rejected.
    assert.deepEqual(await carryUnresolvedLongTermIssues(f.db, f.token, f.fromId, f.fromId), {
      ok: false,
      error: 'quarter_read_only',
    })
    assert.deepEqual(await carryUnresolvedLongTermIssues(f.db, f.token, f.fromId, 999), {
      ok: false,
      error: 'quarter_not_found',
    })
  })

  it('carryLongTermIssue: single-issue carry follows the same rules; short-term rejected', async () => {
    const f = await seedCarryFixture()
    // Short-term issues have no quarter — not found for carry purposes.
    const short = await addIssue(f.db, f.token, { title: 'short', classification: 'short_term' })
    if (!short.ok) throw new Error('fixture failed')
    assert.deepEqual(await carryLongTermIssue(f.db, f.token, short.value.id, f.toId), {
      ok: false,
      error: 'not_found',
    })
    const result = await carryLongTermIssue(f.db, f.token, f.unresolved[0], f.toId)
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.value.quarterId, f.toId)
    const member = await signedInUser(f.db, 'member')
    assert.deepEqual(await carryLongTermIssue(f.db, member.token, f.unresolved[1], f.toId), {
      ok: false,
      error: 'forbidden',
    })
    assert.deepEqual(await carryLongTermIssue(f.db, f.token, f.resolved[0], f.toId), {
      ok: false,
      error: 'already_resolved',
    })
  })
})
