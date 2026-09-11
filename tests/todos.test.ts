import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createTodo,
  completeTodo,
  dropTodo,
  listMyTodos,
  listOpenTodos,
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