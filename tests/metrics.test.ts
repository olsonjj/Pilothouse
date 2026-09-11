import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createMetric, updateMetric, listMetrics } from '../src/server/metrics'
import { createPerson } from '../src/server/people'
import { metrics } from '../src/server/schema'
import { createTestDb, signedInUser } from './helpers'

async function personFor(
  db: Parameters<typeof createMetric>[0],
  token: string,
  name: string,
): Promise<{ id: number }> {
  const person = await createPerson(db, token, { fullName: name })
  if (!person.ok) throw new Error('person fixture failed')
  return person.value
}

const VALID = {
  name: 'Weekly revenue',
  ownerPersonId: 0, // set per-test
  target: 50_000,
  direction: 'gte' as const,
  unit: '$',
}

describe('Scorecard metric definitions (seam, ticket 13)', () => {
  it('admin CRUD round-trips; members see the active-only list', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const member = await signedInUser(db, 'member')
    const owner = await personFor(db, token, 'Alice')

    const created = await createMetric(db, token, { ...VALID, ownerPersonId: owner.id })
    assert.equal(created.ok, true)
    if (!created.ok) throw new Error('create failed')
    assert.equal(created.value.name, 'Weekly revenue')
    assert.equal(created.value.target, 50_000)
    assert.equal(created.value.direction, 'gte')
    assert.equal(created.value.unit, '$')
    assert.equal(created.value.active, 1)

    // Update: rename, re-target, flip direction and unit.
    const updated = await updateMetric(db, token, created.value.id, {
      ...VALID,
      ownerPersonId: owner.id,
      name: 'Weekly revenue ($k)',
      target: 50,
      direction: 'lte',
      unit: 'k$',
    })
    assert.equal(updated.ok, true)
    if (!updated.ok) throw new Error('update failed')
    assert.equal(updated.value.target, 50)
    assert.equal(updated.value.direction, 'lte')
    assert.equal(updated.value.unit, 'k$')

    // Members list (default): sees the active metric.
    const memberList = await listMetrics(db, member.token)
    assert.equal(memberList.ok, true)
    if (memberList.ok) assert.equal(memberList.value.length, 1)

    // includeInactive is admin-gated (ticket-07 rule).
    assert.deepEqual(await listMetrics(db, member.token, true), {
      ok: false,
      error: 'forbidden',
    })
    const adminInactive = await listMetrics(db, token, true)
    assert.equal(adminInactive.ok, true)
    if (adminInactive.ok) assert.equal(adminInactive.value.length, 1)
  })

  it('validation rejects bad input with no persistence', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const owner = await personFor(db, token, 'Alice')

    // Empty name.
    assert.deepEqual(await createMetric(db, token, { ...VALID, ownerPersonId: owner.id, name: '  ' }), {
      ok: false,
      error: 'name_required',
    })
    // Unknown owner.
    assert.deepEqual(await createMetric(db, token, { ...VALID, ownerPersonId: 999 }), {
      ok: false,
      error: 'not_found',
    })
    // Non-finite targets: NaN, Infinity, non-numeric string, missing.
    assert.deepEqual(await createMetric(db, token, { ...VALID, ownerPersonId: owner.id, target: NaN }), {
      ok: false,
      error: 'invalid_target',
    })
    assert.deepEqual(
      await createMetric(db, token, { ...VALID, ownerPersonId: owner.id, target: Infinity }),
      { ok: false, error: 'invalid_target' },
    )
    assert.deepEqual(
      await createMetric(db, token, { ...VALID, ownerPersonId: owner.id, target: 'abc' as unknown as number }),
      { ok: false, error: 'invalid_target' },
    )
    assert.deepEqual(
      await createMetric(db, token, { ...VALID, ownerPersonId: owner.id, target: undefined as unknown as number }),
      { ok: false, error: 'invalid_target' },
    )
    // Numeric-string targets ARE accepted (form inputs arrive as strings).
    const strTarget = await createMetric(db, token, {
      ...VALID,
      ownerPersonId: owner.id,
      target: '123.5' as unknown as number,
    })
    assert.equal(strTarget.ok, true)
    if (strTarget.ok) assert.equal(strTarget.value.target, 123.5)
    // Bad direction.
    assert.deepEqual(
      await createMetric(db, token, { ...VALID, ownerPersonId: owner.id, direction: 'gt' as 'gte' }),
      { ok: false, error: 'invalid_direction' },
    )
    // Update of unknown id.
    assert.deepEqual(await updateMetric(db, token, 999, { ...VALID, ownerPersonId: owner.id }), {
      ok: false,
      error: 'not_found',
    })
    // Nothing persisted by rejected writes (the strTarget row is the only one).
    const rows = await db.select().from(metrics)
    assert.equal(rows.length, 1)
  })

  it('target=0 and negative targets are valid (documented decision)', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const owner = await personFor(db, token, 'Alice')
    // "Defects" targeting zero (lte); deviation-from-baseline targeting below
    // zero (gte). specs/scorecard.md imposes no sign restriction; the seam
    // requires only finiteness.
    const zero = await createMetric(db, token, {
      name: 'Open defects',
      ownerPersonId: owner.id,
      target: 0,
      direction: 'lte',
    })
    assert.equal(zero.ok, true)
    if (zero.ok) assert.equal(zero.value.target, 0)
    const negative = await createMetric(db, token, {
      name: 'Margin deviation',
      ownerPersonId: owner.id,
      target: -2.5,
      direction: 'gte',
    })
    assert.equal(negative.ok, true)
    if (negative.ok) assert.equal(negative.value.target, -2.5)
  })

  it('retire keeps the row, hides it from the default list; reactivate restores', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const owner = await personFor(db, token, 'Alice')
    const created = await createMetric(db, token, { ...VALID, ownerPersonId: owner.id })
    if (!created.ok) throw new Error('create failed')

    const retired = await updateMetric(db, token, created.value.id, {
      ...VALID,
      ownerPersonId: owner.id,
      active: false,
    })
    assert.equal(retired.ok, true)
    if (retired.ok) assert.equal(retired.value.active, 0)

    // Default list hides retired; includeInactive shows it (same id).
    const activeOnly = await listMetrics(db, token)
    if (activeOnly.ok) assert.equal(activeOnly.value.length, 0)
    const all = await listMetrics(db, token, true)
    assert.equal(all.ok, true)
    if (all.ok) {
      assert.equal(all.value.length, 1)
      assert.equal(all.value[0].id, created.value.id)
      assert.equal(all.value[0].active, 0)
    }

    const reactivated = await updateMetric(db, token, created.value.id, {
      ...VALID,
      ownerPersonId: owner.id,
      active: true,
    })
    if (reactivated.ok) assert.equal(reactivated.value.active, 1)
    const again = await listMetrics(db, token)
    if (again.ok) assert.equal(again.value.length, 1)
  })

  it('unauthenticated callers are denied', async () => {
    const { db } = await createTestDb()
    const owner = await personFor(db, (await signedInUser(db)).token, 'Alice')
    assert.deepEqual(await createMetric(db, undefined, { ...VALID, ownerPersonId: owner.id }), {
      ok: false,
      error: 'unauthenticated',
    })
    assert.deepEqual(await updateMetric(db, undefined, 1, { ...VALID, ownerPersonId: owner.id }), {
      ok: false,
      error: 'unauthenticated',
    })
    assert.deepEqual(await listMetrics(db, undefined), { ok: false, error: 'unauthenticated' })
    assert.deepEqual(await listMetrics(db, undefined, true), { ok: false, error: 'unauthenticated' })
  })
})