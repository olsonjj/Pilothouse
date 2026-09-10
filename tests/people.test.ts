import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createPerson,
  updatePerson,
  listPeople,
  linkUserToPerson,
  unlinkUser,
} from '#/server/people'
import { getCurrentUser } from '#/server/auth'
import { people, users } from '#/server/schema'
import { eq } from 'drizzle-orm'
import { createTestDb, signedInUser } from './helpers'

describe('people CRUD', () => {
  it('admin creates a person with name, email, and start date', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const result = await createPerson(db, token, {
      fullName: 'Ada Lovelace',
      email: 'ada@openeos.local',
      startDate: '2026-01-05',
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.value.fullName, 'Ada Lovelace')
    assert.equal(result.value.email, 'ada@openeos.local')
    assert.equal(result.value.startDate, '2026-01-05')
    const rows = await db.select().from(people).all()
    assert.equal(rows.length, 1)
  })

  it('admin creates a person with only a name (email and start date optional)', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const result = await createPerson(db, token, { fullName: 'Nobody Yet' })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.value.email, null)
    assert.equal(result.value.startDate, null)
  })

  it('rejects a person with a blank name', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    assert.deepEqual(await createPerson(db, token, { fullName: '   ' }), {
      ok: false,
      error: 'name_required',
    })
  })

  it('rejects a malformed start date', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    assert.deepEqual(
      await createPerson(db, token, { fullName: 'X', startDate: 'next Tuesday' }),
      { ok: false, error: 'invalid_date' },
    )
  })

  it('rejects a duplicate person email but allows multiple null emails', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const first = await createPerson(db, token, {
      fullName: 'A',
      email: 'same@openeos.local',
    })
    assert.equal(first.ok, true)
    const dup = await createPerson(db, token, {
      fullName: 'B',
      email: ' same@openeos.local ',
    })
    assert.deepEqual(dup, { ok: false, error: 'email_taken' })
    const second = await createPerson(db, token, { fullName: 'B' })
    assert.equal(second.ok, true)
    const third = await createPerson(db, token, { fullName: 'C' })
    assert.equal(third.ok, true)
  })

  it('admin edits a person and their email stays unique', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const a = await createPerson(db, token, { fullName: 'A', email: 'a@openeos.local' })
    const b = await createPerson(db, token, { fullName: 'B', email: 'b@openeos.local' })
    if (!a.ok || !b.ok) throw new Error('fixture failed')
    const edit = await updatePerson(db, token, a.value.id, {
      fullName: 'A Prime',
      startDate: '2026-02-02',
    })
    assert.equal(edit.ok, true)
    if (!edit.ok) return
    assert.equal(edit.value.fullName, 'A Prime')
    assert.equal(edit.value.startDate, '2026-02-02')
    const steal = await updatePerson(db, token, a.value.id, {
      fullName: 'A Prime',
      email: 'b@openeos.local',
    })
    assert.deepEqual(steal, { ok: false, error: 'email_taken' })
  })

  it('update on a missing person is not_found', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    assert.deepEqual(await updatePerson(db, token, 999, { fullName: 'Ghost' }), {
      ok: false,
      error: 'not_found',
    })
  })
})

describe('people access rules', () => {
  it('members can list but not create or edit', async () => {
    const { db } = await createTestDb()
    const admin = await signedInUser(db, 'admin')
    const created = await createPerson(db, admin.token, { fullName: 'Admin Person' })
    if (!created.ok) throw new Error('fixture failed')

    const member = await signedInUser(db, 'member')
    const listed = await listPeople(db, member.token)
    assert.equal(listed.ok, true)
    if (!listed.ok) return
    assert.equal(listed.value.length, 1)
    assert.equal(listed.value[0]?.fullName, 'Admin Person')

    assert.deepEqual(await createPerson(db, member.token, { fullName: 'Sneak' }), {
      ok: false,
      error: 'forbidden',
    })
    assert.deepEqual(
      await updatePerson(db, member.token, created.value.id, { fullName: 'Hacked' }),
      { ok: false, error: 'forbidden' },
    )
  })

  it('requires sign-in to list people', async () => {
    const { db } = await createTestDb()
    assert.deepEqual(await listPeople(db, undefined), {
      ok: false,
      error: 'unauthenticated',
    })
  })
})

describe('account linking', () => {
  it('links a user to a person and unlinks; people without logins are allowed', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const { user } = await signedInUser(db, 'member')

    // A person with no login at all.
    const person = await createPerson(db, token, { fullName: 'No Login Person' })
    assert.equal(person.ok, true)
    if (!person.ok) throw new Error('fixture failed')
    const listed = await listPeople(db, token)
    if (!listed.ok) throw new Error('list failed')
    assert.equal(listed.value[0]?.linkedUser, null)

    const link = await linkUserToPerson(db, token, user.id, person.value!.id)
    assert.equal(link.ok, true)
    const after = await listPeople(db, token)
    if (!after.ok) throw new Error('list failed')
    assert.equal(after.value[0]?.linkedUser?.id, user.id)

    const unlink = await unlinkUser(db, token, user.id)
    assert.equal(unlink.ok, true)
    const cleared = await listPeople(db, token)
    if (!cleared.ok) throw new Error('list failed')
    assert.equal(cleared.value[0]?.linkedUser, null)
    const userRow = await db.select().from(users).where(eq(users.id, user.id)).get()
    assert.equal(userRow?.personId, null)
  })

  it('rejects linking a user already linked to another person and vice versa', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const { user: userA } = await signedInUser(db, 'member')
    const { user: userB } = await signedInUser(db, 'member')
    const p1 = await createPerson(db, token, { fullName: 'P1' })
    const p2 = await createPerson(db, token, { fullName: 'P2' })
    if (!p1.ok || !p2.ok) throw new Error('fixture failed')

    const first = await linkUserToPerson(db, token, userA.id, p1.value.id)
    assert.equal(first.ok, true)

    // userA already belongs to p1 — linking them to p2 must fail.
    assert.deepEqual(
      await linkUserToPerson(db, token, userA.id, p2.value.id),
      { ok: false, error: 'already_linked' },
    )
    // userB joining p1 (already held by userA) must fail too.
    assert.deepEqual(
      await linkUserToPerson(db, token, userB.id, p1.value.id),
      { ok: false, error: 'already_linked' },
    )
    // But userB joining the free person is fine.
    assert.equal((await linkUserToPerson(db, token, userB.id, p2.value.id)).ok, true)
  })

  it('re-linking the same user to the same person is idempotent', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const { user } = await signedInUser(db, 'member')
    const person = await createPerson(db, token, { fullName: 'Steady' })
    if (!person.ok) throw new Error('fixture failed')
    assert.equal((await linkUserToPerson(db, token, user.id, person.value.id)).ok, true)
    assert.equal((await linkUserToPerson(db, token, user.id, person.value.id)).ok, true)
  })

  it('link and unlink are admin-only; unknown ids are not_found', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const { user } = await signedInUser(db, 'member')
    const person = await createPerson(db, token, { fullName: 'Admin Only' })
    if (!person.ok) throw new Error('fixture failed')

    const member = await signedInUser(db, 'member')
    assert.deepEqual(
      await linkUserToPerson(db, member.token, user.id, person.value.id),
      { ok: false, error: 'forbidden' },
    )
    assert.deepEqual(await unlinkUser(db, member.token, user.id), {
      ok: false,
      error: 'forbidden',
    })
    assert.deepEqual(await linkUserToPerson(db, token, 999, person.value.id), {
      ok: false,
      error: 'not_found',
    })
    assert.deepEqual(await linkUserToPerson(db, token, user.id, 999), {
      ok: false,
      error: 'not_found',
    })
  })

  it('display name resolves from the linked person; unlinked accounts keep users.name', async () => {
    const { db } = await createTestDb()
    const { token, user } = await signedInUser(db)
    // Before linking: fallback name.
    const before = await getCurrentUser(db, token)
    assert.equal(before.ok, true)
    if (before.ok) assert.equal(before.user.name, 'Test User')

    const person = await createPerson(db, token, { fullName: 'Grace Hopper' })
    if (!person.ok) throw new Error('fixture failed')
    assert.equal((await linkUserToPerson(db, token, user.id, person.value.id)).ok, true)
    const after = await getCurrentUser(db, token)
    assert.equal(after.ok, true)
    if (after.ok) assert.equal(after.user.name, 'Grace Hopper')

    // After unlinking, the fallback name returns.
    assert.equal((await unlinkUser(db, token, user.id)).ok, true)
    const cleared = await getCurrentUser(db, token)
    assert.equal(cleared.ok, true)
    if (cleared.ok) assert.equal(cleared.user.name, 'Test User')
  })
})