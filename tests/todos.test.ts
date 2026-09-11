import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createTodo,
  completeTodo,
  dropTodo,
  listMyTodos,
  listOpenTodos,
  listTodosByWeek,
  completionRates,
  dueDateFrom,
} from '../src/server/todos'
import { createPerson, linkUserToPerson } from '../src/server/people'
import { todayIso } from '../src/server/week'
import { createTestDb, signedInUser } from './helpers'

describe('dueDateFrom (pure regression guard — pinned literal cases)', () => {
  it('adds exactly 7 calendar days across month/year/leap boundaries', () => {
    assert.equal(dueDateFrom('2025-01-28'), '2025-02-04') // month boundary
    assert.equal(dueDateFrom('2025-12-28'), '2026-01-04') // year boundary
    assert.equal(dueDateFrom('2024-02-23'), '2024-03-01') // leap year
    assert.equal(dueDateFrom('2025-02-22'), '2025-03-01') // non-leap Feb
    assert.equal(dueDateFrom('2025-07-25'), '2025-08-01') // month boundary
  })
})

/**
 * Links a signed-in account to a fresh person (the common fixture: every
 * user acts as a person). Returns the person row.
 */
async function personFor(
  db: Parameters<typeof linkUserToPerson>[0],
  token: string,
  name: string,
) {
  const person = await createPerson(db, token, { fullName: name })
  if (!person.ok) throw new Error('person fixture failed')
  return person.value
}

describe('To-dos: create & complete (seam, ticket 11)', () => {
  it('create assigns the fixed +7-day due date, trims the title, records the creator', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const alice = await personFor(db, token, 'Alice')
    const result = await createTodo(db, token, {
      title: '  Call the bank  ',
      assigneePersonId: alice.id,
    })
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.value.title, 'Call the bank')
      assert.equal(result.value.status, 'open')
      assert.equal(result.value.dueDate, dueDateFrom(todayIso()))
      assert.equal(result.value.sourceMeetingId, null)
      assert.equal(result.value.issueSourceId, null)
    }
  })

  it('rejects an empty title and an unknown assignee', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const alice = await personFor(db, token, 'Alice')
    assert.deepEqual(await createTodo(db, token, { title: '   ', assigneePersonId: alice.id }), {
      ok: false,
      error: 'title_required',
    })
    assert.deepEqual(
      await createTodo(db, token, { title: 'ok', assigneePersonId: alice.id + 999 }),
      { ok: false, error: 'assignee_not_found' },
    )
  })

  it('any member creates a to-do for anyone (shared workspace)', async () => {
    const { db } = await createTestDb()
    const { token: adminToken } = await signedInUser(db) // admin
    const member = await signedInUser(db, 'member')
    const alice = await personFor(db, adminToken, 'Alice')
    const bob = await personFor(db, adminToken, 'Bob')
    // Member creates for Alice and Bob — no ownership limits, no linking needed
    // (created_by records the login account, per the ticket-11 contract).
    for (const target of [alice.id, bob.id]) {
      const result = await createTodo(db, member.token, {
        title: 'Check the numbers',
        assigneePersonId: target,
      })
      assert.equal(result.ok, true)
      if (result.ok) assert.equal(result.value.createdBy, member.user.id)
    }
  })

  it('complete round-trip; completing a dropped to-do is rejected', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const alice = await personFor(db, token, 'Alice')
    const created = await createTodo(db, token, { title: 'Ship it', assigneePersonId: alice.id })
    if (!created.ok) throw new Error('fixture failed')
    assert.equal(created.value.status, 'open')

    const done = await completeTodo(db, token, created.value.id)
    assert.equal(done.ok, true)
    if (done.ok) {
      assert.equal(done.value.status, 'done')
      assert.ok(done.value.completedAt)
    }
    // Done is immutable: re-completing and dropping are rejected.
    assert.deepEqual(await completeTodo(db, token, created.value.id), {
      ok: false,
      error: 'invalid_state',
    })
    assert.deepEqual(await dropTodo(db, token, created.value.id, 'changed mind'), {
      ok: false,
      error: 'invalid_state',
    })
  })

  it('drop requires a non-empty reason; reason is persisted', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const alice = await personFor(db, token, 'Alice')
    const created = await createTodo(db, token, { title: 'Order swag', assigneePersonId: alice.id })
    if (!created.ok) throw new Error('fixture failed')

    // Blank reasons rejected (no state change).
    assert.deepEqual(await dropTodo(db, token, created.value.id, '   '), {
      ok: false,
      error: 'invalid_state',
    })
    const stillOpen = await listOpenTodos(db, token)
    if (stillOpen.ok) assert.equal(stillOpen.value.length, 1)

    const dropped = await dropTodo(db, token, created.value.id, 'Vendor went out of business')
    assert.equal(dropped.ok, true)
    if (dropped.ok) {
      assert.equal(dropped.value.status, 'dropped')
      assert.equal(dropped.value.dropReason, 'Vendor went out of business')
      assert.equal(dropped.value.completedAt, null)
    }
    // Dropped is terminal.
    assert.deepEqual(await dropTodo(db, token, created.value.id, 'again'), {
      ok: false,
      error: 'invalid_state',
    })
  })

  it('unknown to-do ids are not_found', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    assert.deepEqual(await completeTodo(db, token, 9999), { ok: false, error: 'not_found' })
    assert.deepEqual(await dropTodo(db, token, 9999, 'reason'), { ok: false, error: 'not_found' })
  })

  it('my-todos lists only the assignee, sorted by due date; unlinked sees empty', async () => {
    const { db } = await createTestDb()
    const { token: adminToken } = await signedInUser(db)
    const member = await signedInUser(db, 'member')
    const alice = await personFor(db, adminToken, 'Alice')
    const bob = await personFor(db, adminToken, 'Bob')
    // Link the member account to Alice so listMyTodos resolves a person.
    const linked = await linkUserToPerson(db, adminToken, member.user.id, alice.id)
    assert.equal(linked.ok, true)

    assert.equal((await createTodo(db, adminToken, { title: 'Later', assigneePersonId: alice.id })).ok, true)
    assert.equal((await createTodo(db, adminToken, { title: 'Sooner', assigneePersonId: alice.id })).ok, true)
    assert.equal((await createTodo(db, adminToken, { title: "Bob's", assigneePersonId: bob.id })).ok, true)

    const mine = await listMyTodos(db, member.token)
    assert.equal(mine.ok, true)
    if (mine.ok) {
      assert.equal(mine.value.length, 2)
      assert.deepEqual(mine.value.map((t) => t.title), ['Later', 'Sooner'])
      // All rows are Alice's, with her display name joined.
      for (const t of mine.value) {
        assert.equal(t.assigneeName, 'Alice')
        assert.equal(t.assigneePersonId, alice.id)
      }
    }

    // Unlinked account (the admin fixture here) sees an empty my-list, not an error.
    const unlinked = await listMyTodos(db, adminToken)
    assert.equal(unlinked.ok, true)
    if (unlinked.ok) assert.equal(unlinked.value.length, 0)

    // The open list shows everything regardless of assignee.
    const open = await listOpenTodos(db, adminToken)
    if (open.ok) assert.equal(open.value.length, 3)
  })

  it('unauthenticated actions are denied', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const alice = await personFor(db, token, 'Alice')
    assert.deepEqual(await createTodo(db, undefined, { title: 'x', assigneePersonId: alice.id }), {
      ok: false,
      error: 'unauthenticated',
    })
    assert.deepEqual(await completeTodo(db, undefined, 1), { ok: false, error: 'unauthenticated' })
    assert.deepEqual(await dropTodo(db, undefined, 1, 'r'), { ok: false, error: 'unauthenticated' })
    assert.deepEqual(await listMyTodos(db, undefined), { ok: false, error: 'unauthenticated' })
  })
})
describe('To-dos: team view by week + completion rates (seam, ticket 12)', () => {
  it('unauthenticated callers are denied on the new endpoints', async () => {
    const { db } = await createTestDb()
    assert.equal((await listTodosByWeek(db, undefined)).ok, false)
    assert.equal((await completionRates(db, undefined)).ok, false)
  })

  it('listTodosByWeek buckets to-dos by weekStart(due_date), chronological', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    const alice = await personFor(db, token, 'Alice')
    const t1 = await createTodo(db, token, { title: 'A', assigneePersonId: alice.id })
    const t2 = await createTodo(db, token, { title: 'B', assigneePersonId: alice.id })
    if (!t1.ok || !t2.ok) throw new Error('fixture failed')
    // Re-anchor due dates into two distinct weeks (a Wednesday and the next
    // week's Friday) via direct SQL — acceptable seam-level seeding.
    sqlite.exec(`UPDATE todos SET due_date = '2026-03-04' WHERE id = ${t1.value.id}`) // Wed
    sqlite.exec(`UPDATE todos SET due_date = '2026-03-13' WHERE id = ${t2.value.id}`) // Fri next week
    const result = await listTodosByWeek(db, token)
    assert.equal(result.ok, true)
    if (!result.ok) throw new Error('listTodosByWeek failed')
    assert.deepEqual(
      result.value.map((b) => b.weekMonday),
      ['2026-03-02', '2026-03-09'],
    )
    assert.equal(result.value[0].label, 'Week of Mar 2')
    assert.deepEqual(result.value[0].todos.map((t) => t.title), ['A'])
    assert.deepEqual(result.value[1].todos.map((t) => t.title), ['B'])
  })

  it('listOpenTodos puts overdue open to-dos first; ties break by id', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    const alice = await personFor(db, token, 'Alice')
    const today = todayIso()
    const yesterday = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10)
    const tomorrow = new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10)
    const t1 = await createTodo(db, token, { title: 'upcoming', assigneePersonId: alice.id })
    const t2 = await createTodo(db, token, { title: 'overdue-1', assigneePersonId: alice.id })
    const t3 = await createTodo(db, token, { title: 'overdue-2', assigneePersonId: alice.id })
    if (!t1.ok || !t2.ok || !t3.ok) throw new Error('fixture failed')
    sqlite.exec(`UPDATE todos SET due_date = '${tomorrow}' WHERE id = ${t1.value.id}`)
    sqlite.exec(`UPDATE todos SET due_date = '${yesterday}' WHERE id = ${t2.value.id}`)
    sqlite.exec(`UPDATE todos SET due_date = '${yesterday}' WHERE id = ${t3.value.id}`)
    const result = await listOpenTodos(db, token)
    assert.equal(result.ok, true)
    if (!result.ok) throw new Error('listOpenTodos failed')
    // Overdue block first, tie-broken by id; then upcoming.
    assert.deepEqual(
      result.value.map((t) => t.title),
      ['overdue-1', 'overdue-2', 'upcoming'],
    )
  })

  it('completion rates: pinned math — done/(done+open), dropped excluded, window = 4 elapsed weeks', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    const alice = await personFor(db, token, 'Alice')
    const bob = await personFor(db, token, 'Bob')
    const carol = await personFor(db, token, 'Carol')

    // asOf = Wed 2026-03-25. Current week starts Mon 2026-03-23; window =
    // [2026-02-23, 2026-03-23) = the four fully-elapsed weeks.
    const asOf = '2026-03-25'
    async function seed(
      title: string,
      personId: number,
      due: string,
      action: 'none' | 'done' | 'drop',
      id: number,
    ) {
      const created = await createTodo(db, token, { title, assigneePersonId: personId })
      if (!created.ok) throw new Error('fixture failed')
      sqlite.exec(`UPDATE todos SET due_date = '${due}' WHERE id = ${created.value.id}`)
      if (action === 'done') assert.equal((await completeTodo(db, token, created.value.id)).ok, true)
      if (action === 'drop') assert.equal((await dropTodo(db, token, created.value.id, 'obsolete')).ok, true)
      void id
    }

    // Alice: 2 done + 1 open (past due, missed) in window → 2/3 = 66.7%.
    await seed('a-done-1', alice.id, '2026-02-24', 'done', 1)
    await seed('a-done-2', alice.id, '2026-03-09', 'done', 2)
    await seed('a-missed', alice.id, '2026-03-05', 'none', 3)
    // Bob: 1 done in window → 1/1 = 100%.
    await seed('b-done', bob.id, '2026-03-16', 'done', 4)
    // Dropped in window: EXCLUDED from both sides (honesty decision).
    await seed('a-dropped', alice.id, '2026-02-26', 'drop', 5)
    // Out of window: due in current week (open) and before the window.
    await seed('current-week', alice.id, '2026-03-24', 'none', 6)
    await seed('before-window', alice.id, '2026-02-15', 'done', 7)
    // BOUNDARY PINS (ticket-12 review): a ±1-day window bug must flip rates.
    // Lower bound: done due the day BEFORE windowStart → excluded. A
    // windowStart−1 bug would include it (Alice 3/4=75, team 4/5=80).
    await seed('before-window-edge', alice.id, '2026-02-22', 'done', 8)
    // Current-week leak: open due Monday of the current week → excluded. An
    // off-by-one upper-bound bug would count it (Alice 2/4=50, team 3/5=60).
    await seed('current-week-monday', alice.id, '2026-03-23', 'none', 9)
    // Upper-bound inclusion: done due the LAST window day (2026-03-22) → in.
    // Excluding it would zero Carol and flip the team rate back to 3/4=75.
    await seed('last-window-day', carol.id, '2026-03-22', 'done', 10)

    const result = await completionRates(db, token, asOf)
    assert.equal(result.ok, true)
    if (!result.ok) throw new Error('completionRates failed')
    assert.equal(result.value.windowStart, '2026-02-23')
    assert.equal(result.value.windowEnd, '2026-03-23')

    const aliceRate = result.value.people.find((p) => p.personName === 'Alice')
    assert.ok(aliceRate, 'alice missing')
    assert.equal(aliceRate.done, 2)
    assert.equal(aliceRate.counted, 3)
    assert.equal(aliceRate.rate, 66.7)

    const bobRate = result.value.people.find((p) => p.personName === 'Bob')
    assert.ok(bobRate, 'bob missing')
    assert.equal(bobRate.rate, 100)

    // Carol's only window to-do is due the last window day — pins inclusion.
    const carolRate = result.value.people.find((p) => p.personName === 'Carol')
    assert.ok(carolRate, 'carol missing (last-window-day row excluded?)')
    assert.equal(carolRate.done, 1)
    assert.equal(carolRate.counted, 1)
    assert.equal(carolRate.rate, 100)

    assert.equal(result.value.team.done, 4)
    assert.equal(result.value.team.counted, 5)
    assert.equal(result.value.team.rate, 80)
  })

  it('completion rates: empty window yields null rate, not NaN', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const alice = await personFor(db, token, 'Alice')
    assert.equal((await createTodo(db, token, { title: 'future', assigneePersonId: alice.id })).ok, true)
    const result = await completionRates(db, token, todayIso())
    assert.equal(result.ok, true)
    if (!result.ok) throw new Error('completionRates failed')
    assert.equal(result.value.team.counted, 0)
    assert.equal(result.value.team.rate, null)
  })
})
