import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  signIn,
  getCurrentUser,
  requireRole,
  signOut,
  cleanupExpiredSessions,
  createSession,
  hashPassword,
  verifyPassword,
} from '#/server/auth'
import { sessions, users } from '#/server/schema'
import { eq } from 'drizzle-orm'
import { createTestDb, signedInUser, owner } from './helpers'

describe('sign-in', () => {
  it('signs in the seeded owner with valid credentials', async () => {
    const { db } = await createTestDb()
    const result = await signIn(db, owner.email, owner.password)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.user.role, 'admin')
    assert.match(result.sessionToken, /^[0-9a-f]{64}$/)
  })

  it('rejects a wrong password and does not create a session', async () => {
    const { db } = await createTestDb()
    const result = await signIn(db, owner.email, 'wrong-password')
    assert.deepEqual(result, { ok: false, error: 'invalid_credentials' })
    assert.equal((await db.select().from(sessions).all()).length, 0)
  })

  it('rejects an unknown email', async () => {
    const { db } = await createTestDb()
    assert.deepEqual(await signIn(db, 'nobody@pilothouse.local', 'irrelevant'), {
      ok: false,
      error: 'invalid_credentials',
    })
  })
})

describe('sessions', () => {
  it('resolves the current user from a valid session token', async () => {
    const { db } = await createTestDb()
    const { token, user } = await signedInUser(db)
    const result = await getCurrentUser(db, token)
    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual(result.user, user)
  })

  it('rejects an expired session', async () => {
    const { db } = await createTestDb()
    const ownerRow = await db.select().from(users).where(eq(users.email, owner.email)).get()
    if (!ownerRow) throw new Error('owner missing')
    const expired = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    await db
      .insert(sessions)
      .values({ token: 'expired-token', userId: ownerRow.id, expiresAt: expired })

    assert.deepEqual(await getCurrentUser(db, 'expired-token'), {
      ok: false,
      error: 'unauthenticated',
    })
  })

  it('rejects an unknown token and a missing token', async () => {
    const { db } = await createTestDb()
    assert.deepEqual(await getCurrentUser(db, 'no-such-token'), {
      ok: false,
      error: 'unauthenticated',
    })
    assert.deepEqual(await getCurrentUser(db, undefined), {
      ok: false,
      error: 'unauthenticated',
    })
  })

  it('signs out by deleting the session row', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    await signOut(db, token)
    assert.equal((await getCurrentUser(db, token)).ok, false)
  })

  it('creates sessions that expire after the TTL', async () => {
    const { db } = await createTestDb()
    const now = new Date('2025-06-01T12:00:00Z')
    const token = await createSession(db, 1, now)
    const row = await db.select().from(sessions).where(eq(sessions.token, token)).get()
    assert.equal(row?.expiresAt, new Date('2025-07-01T12:00:00Z').toISOString())
  })

  it('cleanup removes only expired sessions', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db) // fresh, unexpired
    const ownerRow = await db.select().from(users).where(eq(users.email, owner.email)).get()
    if (!ownerRow) throw new Error('owner missing')
    await db
      .insert(sessions)
      .values({
        token: 'stale',
        userId: ownerRow.id,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      })

    const removed = await cleanupExpiredSessions(db)
    assert.equal(removed, 1)
    assert.equal((await getCurrentUser(db, token)).ok, true)
  })
})

describe('role enforcement', () => {
  it('allows an admin through requireRole(admin)', async () => {
    const { db } = await createTestDb()
    const { token, user } = await signedInUser(db, 'admin')
    const result = await requireRole(db, token, 'admin')
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.user.id, user.id)
  })

  it('denies a member an admin-only action', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db, 'member')
    assert.deepEqual(await requireRole(db, token, 'admin'), { ok: false, error: 'forbidden' })
  })

  it('requires authentication before role matters', async () => {
    const { db } = await createTestDb()
    assert.deepEqual(await requireRole(db, undefined, 'admin'), {
      ok: false,
      error: 'unauthenticated',
    })
  })
})

describe('password hashing', () => {
  it('stores salted scrypt hashes and verifies round-trip', () => {
    const hash = hashPassword('secret')
    assert.match(hash, /^[0-9a-f]+:[0-9a-f]{128}$/)
    assert.equal(verifyPassword('secret', hash), true)
    assert.equal(verifyPassword('other', hash), false)
  })
})

describe('seeding', () => {
  it('seeds the owner only once', async () => {
    const { db } = await createTestDb()
    const owners = await db.select().from(users).where(eq(users.role, 'admin')).all()
    assert.equal(owners.length, 1)
    assert.equal(owners[0]?.email, owner.email)
  })
})