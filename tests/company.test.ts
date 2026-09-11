import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  getVto,
  updateVto,
  listVtoVersions,
  restoreVtoVersion,
  backfillVtoFirstVersion,
  type VtoInput,
} from '#/server/vto'
import { vto } from '#/server/schema'
import { createTestDb, signedInUser, owner } from './helpers'
import { signIn } from '#/server/auth'

const FULL_INPUT: VtoInput = {
  coreFocusWhy: 'To make great tools',
  coreFocusWhat: 'We build EOS software',
  tenYearTarget: '$100M valuation',
  tenYearTargetDate: '2036-12-31',
  marketingTargetMarket: 'Small EOS companies',
  marketingThreeUniques: ['Simple', 'Local-first', 'Cheap'],
  marketingProvenProcess: 'Ship weekly',
  marketingGuarantee: 'Money back',
  threeYearDate: '2029-06-30',
  threeYearRevenue: 1_000_000,
  threeYearProfit: 200_000,
  threeYearItems: ['Team of 30', 'Two products'],
  oneYearLabel: '2027',
  oneYearRevenue: 250_000,
  oneYearProfit: 50_000,
  oneYearItems: ['Launch v1'],
  oneYearPriorities: ['Hire engineer', 'Close 10 customers'],
}

async function adminToken(db: Awaited<ReturnType<typeof createTestDb>>['db']) {
  const result = await signIn(db, owner.email, owner.password)
  if (!result.ok) throw new Error('owner sign-in fixture failed')
  return result.sessionToken
}

describe('company read', () => {
  it('getVto on an empty document returns defaults, not an error', async () => {
    const { db } = await createTestDb()
    const token = await adminToken(db)
    const result = await getVto(db, token)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.value.exists, false)
    assert.equal(result.value.coreFocusWhy, '')
    assert.deepEqual(result.value.marketingThreeUniques, [])
    assert.equal(result.value.threeYearRevenue, null)
  })

  it('getVto is readable by members and rejects unauthenticated callers', async () => {
    const { db } = await createTestDb()
    const member = await signedInUser(db, 'member')
    assert.equal((await getVto(db, member.token)).ok, true)
    assert.deepEqual(await getVto(db, undefined), { ok: false, error: 'unauthenticated' })
  })
})

describe('company update', () => {
  it('admin save round-trips every field through the live row', async () => {
    const { db } = await createTestDb()
    const token = await adminToken(db)

    const saved = await updateVto(db, token, FULL_INPUT)
    assert.equal(saved.ok, true)
    if (!saved.ok) return
    assert.equal(saved.value.exists, true)
    assert.equal(saved.value.coreFocusWhy, 'To make great tools')
    assert.deepEqual(saved.value.marketingThreeUniques, ['Simple', 'Local-first', 'Cheap'])
    assert.deepEqual(saved.value.threeYearItems, ['Team of 30', 'Two products'])
    assert.deepEqual(saved.value.oneYearPriorities, ['Hire engineer', 'Close 10 customers'])
    assert.equal(saved.value.threeYearRevenue, 1_000_000)
    assert.equal(saved.value.tenYearTargetDate, '2036-12-31')
    assert.ok(saved.value.updatedAt)

    // Read-back through the public getter matches.
    const read = await getVto(db, token)
    assert.equal(read.ok, true)
    if (read.ok) {
      assert.deepEqual(read.value.oneYearPriorities, saved.value.oneYearPriorities)
      assert.equal(read.value.marketingProvenProcess, 'Ship weekly')
    }
  })

  it('saving twice updates the single row instead of creating a new one', async () => {
    const { db, sqlite } = await createTestDb()
    const token = await adminToken(db)
    assert.equal((await updateVto(db, token, FULL_INPUT)).ok, true)
    const second = await updateVto(db, token, { ...FULL_INPUT, tenYearTarget: 'Bigger' })
    assert.equal(second.ok, true)
    const rows = sqlite.prepare('SELECT COUNT(*) AS n FROM vto').get() as { n: number }
    assert.equal(rows.n, 1)
    const check = await getVto(db, token)
    if (check.ok) assert.equal(check.value.tenYearTarget, 'Bigger')
  })

  it('member edits are rejected at the seam', async () => {
    const { db } = await createTestDb()
    const member = await signedInUser(db, 'member')
    assert.deepEqual(await updateVto(db, member.token, FULL_INPUT), {
      ok: false,
      error: 'forbidden',
    })
  })

  it('unauthenticated edits are rejected', async () => {
    const { db } = await createTestDb()
    assert.deepEqual(await updateVto(db, undefined, FULL_INPUT), {
      ok: false,
      error: 'unauthenticated',
    })
  })

  it('malformed payloads are rejected with specific errors', async () => {
    const { db } = await createTestDb()
    const token = await adminToken(db)

    // Missing required core focus.
    assert.deepEqual(
      await updateVto(db, token, { ...FULL_INPUT, coreFocusWhy: '' }),
      { ok: false, error: 'missing_required' },
    )
    // Not an array.
    assert.deepEqual(
      await updateVto(db, token, { ...FULL_INPUT, marketingThreeUniques: 'one' as unknown as string[] }),
      { ok: false, error: 'invalid_list' },
    )
    // EOS: at most three uniques.
    assert.deepEqual(
      await updateVto(db, token, { ...FULL_INPUT, marketingThreeUniques: ['a', 'b', 'c', 'd'] }),
      { ok: false, error: 'invalid_list' },
    )
    // Non-string list item.
    assert.deepEqual(
      await updateVto(db, token, { ...FULL_INPUT, oneYearItems: ['ok', 7] as unknown as string[] }),
      { ok: false, error: 'invalid_list' },
    )
    // Negative / non-integer money.
    assert.deepEqual(
      await updateVto(db, token, { ...FULL_INPUT, oneYearRevenue: -5 }),
      { ok: false, error: 'invalid_number' },
    )
    assert.deepEqual(
      await updateVto(db, token, { ...FULL_INPUT, threeYearProfit: 1.5 }),
      { ok: false, error: 'invalid_number' },
    )
    // Bad dates.
    assert.deepEqual(
      await updateVto(db, token, { ...FULL_INPUT, tenYearTargetDate: '2036' }),
      { ok: false, error: 'invalid_date' },
    )
    assert.deepEqual(
      await updateVto(db, token, { ...FULL_INPUT, threeYearDate: '2029-13-01' }),
      { ok: false, error: 'invalid_date' },
    )
    // Nothing persisted by rejected writes.
    const rows = await db.select().from(vto)
    assert.equal(rows.length, 0)
  })

  it('corrupt JSON list columns degrade to empty lists, not crashes', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    // Save a valid V/TO first, then corrupt a JSON column directly in SQLite.
    assert.equal(
      (await updateVto(db, token, { ...FULL_INPUT, marketingThreeUniques: ['A', 'B', 'C'] })).ok,
      true,
    )
    sqlite.exec("UPDATE vto SET marketing_three_uniques = '{oops' WHERE id = 1")
    const result = await getVto(db, token)
    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual(result.value.marketingThreeUniques, [])
  })
})
describe('company version history (ticket 06)', () => {
  it('each save creates a new version with author and published_at; publishedAt tracks the newest', async () => {
    const { db } = await createTestDb()
    const { token, user } = await signedInUser(db)

    const first = await updateVto(db, token, {
      ...FULL_INPUT,
      tenYearTarget: 'Version one',
    })
    assert.equal(first.ok, true)
    const second = await updateVto(db, token, {
      ...FULL_INPUT,
      tenYearTarget: 'Version two',
    })
    assert.equal(second.ok, true)

    const history = await listVtoVersions(db, token)
    assert.equal(history.ok, true)
    if (!history.ok) throw new Error('history failed')
    assert.equal(history.value.length, 2)
    // Newest first; both authored by the saving admin.
    for (const entry of history.value) assert.equal(entry.authorEmail, user.email)

    // publishedAs-of = newest snapshot's published_at.
    const read = await getVto(db, token)
    assert.equal(read.ok, true)
    if (read.ok) assert.equal(read.value.publishedAt, history.value[0].publishedAt)
  })

  it('restore copies old content into the live row, appends a new version, and keeps history append-only', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)

    // v1 = "Version one", v2 = "Version two".
    const v1 = await updateVto(db, token, { ...FULL_INPUT, tenYearTarget: 'Version one' })
    const v2 = await updateVto(db, token, { ...FULL_INPUT, tenYearTarget: 'Version two' })
    assert.equal(v1.ok && v2.ok, true)
    const historyBefore = await listVtoVersions(db, token)
    if (!historyBefore.ok) throw new Error('history failed')
    assert.equal(historyBefore.value.length, 2)
    const oldestId = historyBefore.value[1].id

    // Restore v1 (currently the oldest).
    const restored = await restoreVtoVersion(db, token, oldestId)
    assert.equal(restored.ok, true)
    if (restored.ok) assert.equal(restored.value.tenYearTarget, 'Version one')

    // Live row reflects the restored content.
    const read = await getVto(db, token)
    assert.equal(read.ok, true)
    if (read.ok) assert.equal(read.value.tenYearTarget, 'Version one')

    // History grew by one (append-only); originals intact, newest = the restore.
    const historyAfter = await listVtoVersions(db, token)
    assert.equal(historyAfter.ok, true)
    if (!historyAfter.ok) throw new Error('history failed')
    assert.equal(historyAfter.value.length, 3)
    assert.equal(historyAfter.value[2].id, oldestId, 'original version still present')
    assert.notEqual(historyAfter.value[0].id, oldestId, 'newest row is the new version')
  })

  it('restore of an unknown version is not_found; members and unauthenticated denied everywhere', async () => {
    const { db } = await createTestDb()
    const { token, user } = await signedInUser(db)
    const member = await signedInUser(db, 'member')
    assert.deepEqual(await updateVto(db, token, FULL_INPUT).then(() => true), true)

    assert.deepEqual(await restoreVtoVersion(db, token, 999), { ok: false, error: 'not_found' })
    assert.deepEqual(await listVtoVersions(db, member.token), { ok: false, error: 'forbidden' })
    assert.deepEqual(await restoreVtoVersion(db, member.token, 1), { ok: false, error: 'forbidden' })
    assert.deepEqual(await listVtoVersions(db, undefined), { ok: false, error: 'unauthenticated' })
    assert.deepEqual(await restoreVtoVersion(db, undefined, 1), {
      ok: false,
      error: 'unauthenticated',
    })
    assert.equal(user.role, 'admin')
  })

  it('backfill copies a pre-existing vto row into the first version (idempotent)', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    // Simulate a pre-ticket-06 DB: write the live row without any version.
    sqlite.exec(
      `INSERT INTO vto (id, updated_at, core_focus_why, core_focus_what, marketing_three_uniques)
       VALUES (1, '2025-01-15T10:00:00Z', 'Legacy why', 'Legacy what', '[]')`,
    )
    const before = await listVtoVersions(db, token)
    assert.equal(before.ok, true)
    if (before.ok) assert.equal(before.value.length, 0)

    await backfillVtoFirstVersion(db)
    const after = await listVtoVersions(db, token)
    assert.equal(after.ok, true)
    if (!after.ok) throw new Error('history failed')
    assert.equal(after.value.length, 1)
    assert.equal(after.value[0].publishedAt, '2025-01-15T10:00:00Z')

    const read = await getVto(db, token)
    assert.equal(read.ok, true)
    if (read.ok) {
      assert.equal(read.value.coreFocusWhy, 'Legacy why')
      assert.equal(read.value.publishedAt, '2025-01-15T10:00:00Z')
    }

    // Idempotent: running again must not duplicate.
    await backfillVtoFirstVersion(db)
    const again = await listVtoVersions(db, token)
    if (again.ok) assert.equal(again.value.length, 1)
  })

  it('backfill with an empty vto row is a no-op (no version created)', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    // No vto row has ever been saved: delete the nothing that exists.
    await db.delete(vto)
    await backfillVtoFirstVersion(db)
    const history = await listVtoVersions(db, token)
    assert.equal(history.ok, true)
    if (history.ok) assert.equal(history.value.length, 0)
  })
})
