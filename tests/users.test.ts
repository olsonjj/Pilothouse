import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createUser,
  resetPassword,
  setRole,
  listUsers,
  MIN_PASSWORD_LENGTH,
} from '../src/server/userManagement'
import { getCurrentUser, signIn } from '../src/server/auth'
import { createPerson, linkUserToPerson } from '../src/server/people'
import { createTestDb, signedInUser } from './helpers'

describe('Admin user management (seam, ticket 26)', () => {
  it('create round-trip: email/name/role persisted, password signs in', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db) // admin

    const created = await createUser(db, token, {
      email: 'sarah@company.com',
      name: 'Sarah',
      password: 'longenough1',
      role: 'member',
    })
    assert.equal(created.ok, true)
    if (!created.ok) throw new Error('create failed')
    assert.equal(created.value.email, 'sarah@company.com')
    assert.equal(created.value.name, 'Sarah')
    assert.equal(created.value.role, 'member')
    assert.equal(created.value.personId, null)

    // The stored hash verifies: the new user can sign in.
    const signInResult = await signIn(db, 'sarah@company.com', 'longenough1')
    assert.equal(signInResult.ok, true)
    if (signInResult.ok) assert.equal(signInResult.user.name, 'Sarah')
  })

  it('create has no auto-session: the new user is not signed in by creation', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const created = await createUser(db, token, {
      email: 's2@company.com',
      name: 'S2',
      password: 'longenough1',
      role: 'member',
    })
    assert.equal(created.ok, true)
    // Only the admin's session exists — count sessions for the new user.
    const { sessions } = await import('../src/server/schema')
    const { eq } = await import('drizzle-orm')
    const rows = await db.select().from(sessions).where(eq(sessions.userId, created.value.id))
    assert.equal(rows.length, 0)
  })

  it('duplicate email rejected — case-sensitive, matching the users.email unique index', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const base = { name: 'X', password: 'longenough1', role: 'member' as const }

    assert.deepEqual(await createUser(db, token, { ...base, email: 'dup@co.com' }).then((r) => r.ok), true)
    // Exact duplicate.
    assert.deepEqual(await createUser(db, token, { ...base, email: 'dup@co.com' }), {
      ok: false,
      error: 'email_taken',
    })
    // Case-variant is ALLOWED (index is case-sensitive) — pin the convention.
    const variant = await createUser(db, token, { ...base, email: 'DUP@co.com' })
    assert.equal(variant.ok, true)
  })

  it('email/name validation: empty, implausible; role validated', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const base = { name: 'X', password: 'longenough1', role: 'member' as const }

    assert.deepEqual(await createUser(db, token, { ...base, email: '' }), {
      ok: false,
      error: 'email_required',
    })
    assert.deepEqual(await createUser(db, token, { ...base, email: 'not-an-email' }), {
      ok: false,
      error: 'email_invalid',
    })
    assert.deepEqual(await createUser(db, token, { ...base, email: 'a@b.com', name: '  ' }), {
      ok: false,
      error: 'name_required',
    })
    assert.deepEqual(
      await createUser(db, token, { ...base, email: 'a@b.com', name: 'X', role: 'owner' as 'admin' }),
      { ok: false, error: 'invalid_role' },
    )
  })

  it(`password boundary: ${MIN_PASSWORD_LENGTH - 1} chars rejected, ${MIN_PASSWORD_LENGTH} accepted`, async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const base = { email: 'p@co.com', name: 'X', role: 'member' as const }

    assert.deepEqual(await createUser(db, token, { ...base, password: 'a'.repeat(7) }), {
      ok: false,
      error: 'password_too_short',
    })
    assert.deepEqual(await createUser(db, token, { ...base, password: '' }), {
      ok: false,
      error: 'password_required',
    })
    const ok = await createUser(db, token, { ...base, password: 'a'.repeat(8) })
    assert.equal(ok.ok, true)
  })

  it('reset: new password signs in, old one does not, ALL sessions invalidated', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db) // admin
    const created = await createUser(db, token, {
      email: 'r@co.com',
      name: 'R',
      password: 'originalpw1',
      role: 'member',
    })
    if (!created.ok) throw new Error('fixture failed')

    // A second live session for the target user (two devices).
    const secondSession = await signIn(db, 'r@co.com', 'originalpw1')
    assert.equal(secondSession.ok, true)

    // Old tokens work before the reset.
    assert.equal((await getCurrentUser(db, secondSession.sessionToken)).ok, true)

    const reset = await resetPassword(db, token, created.value.id, 'brandnew99')
    assert.equal(reset.ok, true)

    // Old session is invalid now (pin: old cookie stops working).
    assert.deepEqual(await getCurrentUser(db, secondSession.sessionToken), {
      ok: false,
      error: 'unauthenticated',
    })
    // Old password rejected; new password signs in.
    assert.equal((await signIn(db, 'r@co.com', 'originalpw1')).ok, false)
    assert.equal((await signIn(db, 'r@co.com', 'brandnew99')).ok, true)
  })

  it('reset validation: too-short rejected, unknown user rejected', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const created = await createUser(db, token, {
      email: 'v@co.com',
      name: 'V',
      password: 'longenough1',
      role: 'member',
    })
    if (!created.ok) throw new Error('fixture failed')
    assert.deepEqual(await resetPassword(db, token, created.value.id, 'short1'), {
      ok: false,
      error: 'password_too_short',
    })
    assert.deepEqual(await resetPassword(db, token, 9999, 'longenough1'), {
      ok: false,
      error: 'not_found',
    })
  })

  it('role flip: member→admin and admin→member work on OTHERS; self-role-change rejected', async () => {
    const { db } = await createTestDb()
    const { token, user: adminUser } = await signedInUser(db)
    const created = await createUser(db, token, {
      email: 'f@co.com',
      name: 'F',
      password: 'longenough1',
      role: 'member',
    })
    if (!created.ok) throw new Error('fixture failed')

    assert.equal((await setRole(db, token, created.value.id, 'admin')).ok, true)
    const promoted = await signIn(db, 'f@co.com', 'longenough1')
    if (promoted.ok) assert.equal(promoted.user.role, 'admin')

    assert.equal((await setRole(db, token, created.value.id, 'member')).ok, true)
    const demoted = await signIn(db, 'f@co.com', 'longenough1')
    if (demoted.ok) assert.equal(demoted.user.role, 'member')

    // Self-role-change rejected (last-admin lockout guard).
    assert.deepEqual(await setRole(db, token, adminUser.id, 'member'), {
      ok: false,
      error: 'self_role_change',
    })
    // The admin is still an admin.
    assert.equal((await listUsers(db, token)).ok, true)
  })

  it('list: admin sees all users with linked-person info; member forbidden; unauth denied', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db) // admin (unlinked)
    const member = await signedInUser(db, 'member')

    const created = await createUser(db, token, {
      email: 'linked@co.com',
      name: 'Linked Account Name',
      password: 'longenough1',
      role: 'member',
    })
    if (!created.ok) throw new Error('fixture failed')
    const person = await createPerson(db, token, { fullName: 'Linked Person' })
    if (!person.ok) throw new Error('person fixture failed')
    assert.equal((await linkUserToPerson(db, token, created.value.id, person.value.id)).ok, true)

    const list = await listUsers(db, token)
    assert.equal(list.ok, true)
    if (!list.ok) throw new Error('list failed')
    const linked = list.value.find((u) => u.email === 'linked@co.com')
    assert.ok(linked)
    assert.equal(linked.personName, 'Linked Person')
    const unlinked = list.value.find((u) => u.email === 'owner@boardroom.local')
    assert.ok(unlinked)
    assert.equal(unlinked.personName, null)

    assert.deepEqual(await listUsers(db, member.token), { ok: false, error: 'forbidden' })
    assert.deepEqual(await listUsers(db, undefined), { ok: false, error: 'unauthenticated' })
    assert.deepEqual(
      await createUser(db, member.token, {
        email: 'x@co.com',
        name: 'X',
        password: 'longenough1',
        role: 'member',
      }),
      { ok: false, error: 'forbidden' },
    )
    assert.deepEqual(await resetPassword(db, member.token, 1, 'longenough1'), {
      ok: false,
      error: 'forbidden',
    })
    assert.deepEqual(await setRole(db, member.token, 1, 'admin'), { ok: false, error: 'forbidden' })
    // Unauthenticated denials (review P2 — pin all four entry points).
    assert.deepEqual(await createUser(db, undefined, {
      email: 'x@co.com', name: 'X', password: 'longenough1', role: 'member',
    }), { ok: false, error: 'unauthenticated' })
    assert.deepEqual(await resetPassword(db, undefined, 1, 'longenough1'), {
      ok: false,
      error: 'unauthenticated',
    })
    assert.deepEqual(await setRole(db, undefined, 1, 'admin'), {
      ok: false,
      error: 'unauthenticated',
    })
  })
})