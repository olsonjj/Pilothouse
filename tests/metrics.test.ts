import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createMetric,
  updateMetric,
  listMetrics,
  setEntry,
  listEntriesForGrid,
  listEntriesForMetric,
} from '../src/server/metrics'
import { createPerson, linkUserToPerson } from '../src/server/people'
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
describe('Scorecard weekly entries + grid (seam, ticket 14)', () => {
  it('setEntry round-trips; re-entry overwrites actual AND re-captures target_at_entry (re-target history basis)', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const alice = await personFor(db, token, 'Alice')
    const metric = await createMetric(db, token, { ...VALID, ownerPersonId: alice.id, target: 100 })
    if (!metric.ok) throw new Error('fixture failed')

    const first = await setEntry(db, token, metric.value.id, '2026-03-23', 120)
    assert.equal(first.ok, true)
    if (first.ok) {
      assert.equal(first.value.week, '2026-03-23') // already a Monday
      assert.equal(first.value.actual, 120)
      assert.equal(first.value.targetAtEntry, 100)
    }

    // Overwrite in the same week.
    const second = await setEntry(db, token, metric.value.id, '2026-03-25', 90)
    assert.equal(second.ok, true)
    if (second.ok) {
      assert.equal(second.value.id, first.ok ? first.value.id : -1) // same row
      assert.equal(second.value.week, '2026-03-23') // normalized to Monday
      assert.equal(second.value.actual, 90)
      assert.equal(second.value.targetAtEntry, 100)
    }

    // Re-target, then re-enter: the entry's basis becomes the NEW target.
    assert.equal(
      (await updateMetric(db, token, metric.value.id, {
        ...VALID,
        ownerPersonId: alice.id,
        target: 80,
      })).ok,
      true,
    )
    const third = await setEntry(db, token, metric.value.id, '2026-03-26', 85)
    assert.equal(third.ok, true)
    if (third.ok) {
      assert.equal(third.value.week, '2026-03-23')
      assert.equal(third.value.actual, 85)
      assert.equal(third.value.targetAtEntry, 80)
      // pass derives against the NEW basis: 85 >= 80.
    }
    const grid = await listEntriesForGrid(db, token, 1, '2026-03-27')
    assert.equal(grid.ok, true)
    if (grid.ok) assert.equal(grid.value.metrics[0]!.cells[0]!.pass, true)
  })

  it('traffic lights derive direction-aware with inclusive boundaries (never hand-set)', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const alice = await personFor(db, token, 'Alice')
    const gte = await createMetric(db, token, { ...VALID, ownerPersonId: alice.id, target: 10 })
    const lte = await createMetric(db, token, {
      name: 'Defects',
      ownerPersonId: alice.id,
      target: 5,
      direction: 'lte',
    })
    if (!gte.ok || !lte.ok) throw new Error('fixture failed')

    // gte target 10: 10 → pass (boundary inclusive), 9.9 → fail.
    assert.equal((await setEntry(db, token, gte.value.id, '2026-03-23', 10)).ok, true)
    assert.equal((await setEntry(db, token, gte.value.id, '2026-03-30', 9.9)).ok, true)
    // lte target 5: 5 → pass, 5.1 → fail.
    assert.equal((await setEntry(db, token, lte.value.id, '2026-03-23', 5)).ok, true)
    assert.equal((await setEntry(db, token, lte.value.id, '2026-03-30', 5.1)).ok, true)

    const grid = await listEntriesForGrid(db, token, 2, '2026-04-03')
    assert.equal(grid.ok, true)
    if (!grid.ok) throw new Error('grid failed')
    const gteRow = grid.value.metrics.find((m) => m.id === gte.value.id)!
    const lteRow = grid.value.metrics.find((m) => m.id === lte.value.id)!
    assert.deepEqual(gteRow.cells.map((c) => c.pass), [true, false])
    assert.deepEqual(lteRow.cells.map((c) => c.pass), [true, false])
    // Not hand-set: cells carry entry ids + basis for provenance.
    assert.equal(gteRow.cells[0]!.targetAtEntry, 10)
    assert.ok(gteRow.cells[0]!.entryId != null)
  })

  it('week normalization: mid-week dates land on their Monday (pinned)', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const alice = await personFor(db, token, 'Alice')
    const metric = await createMetric(db, token, { ...VALID, ownerPersonId: alice.id })
    if (!metric.ok) throw new Error('fixture failed')
    const wed = await setEntry(db, token, metric.value.id, '2026-03-25', 1) // Wed
    assert.equal(wed.ok, true)
    if (wed.ok) assert.equal(wed.value.week, '2026-03-23')
    const sun = await setEntry(db, token, metric.value.id, '2026-03-29', 2) // Sun
    assert.equal(sun.ok, true)
    if (sun.ok) assert.equal(sun.value.week, '2026-03-23') // same week → overwrite
    // Bad weeks rejected without persisting.
    assert.deepEqual(await setEntry(db, token, metric.value.id, '2026-3-5', 1), {
      ok: false,
      error: 'invalid_week',
    })
    assert.deepEqual(await setEntry(db, token, metric.value.id, '2026-02-30', 1), {
      ok: false,
      error: 'invalid_week',
    })
  })

  it('permission matrix: admin any; owner own; member non-owner forbidden; unauth denied', async () => {
    const { db } = await createTestDb()
    const admin = await signedInUser(db)
    const alice = await personFor(db, admin.token, 'Alice')
    const member = await signedInUser(db, 'member')
    const metric = await createMetric(db, admin.token, { ...VALID, ownerPersonId: alice.id })
    if (!metric.ok) throw new Error('fixture failed')

    // Owner (linked to Alice) can enter their own metric.
    const aliceUser = await signedInUser(db)
    assert.equal((await linkUserToPerson(db, admin.token, aliceUser.user.id, alice.id)).ok, true)
    assert.equal(
      (await setEntry(db, aliceUser.token, metric.value.id, '2026-03-23', 7)).ok,
      true,
    )
    // Non-owner member forbidden.
    assert.deepEqual(await setEntry(db, member.token, metric.value.id, '2026-03-23', 7), {
      ok: false,
      error: 'forbidden',
    })
    // Unauthenticated denied.
    assert.deepEqual(await setEntry(db, undefined, metric.value.id, '2026-03-23', 7), {
      ok: false,
      error: 'unauthenticated',
    })
    // Admin can enter any metric (admin fixture is unlinked ≠ owner).
    assert.equal((await setEntry(db, admin.token, metric.value.id, '2026-03-30', 8)).ok, true)
  })

  it('inactive metrics reject entries; retired metrics keep readable history', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const alice = await personFor(db, token, 'Alice')
    const metric = await createMetric(db, token, { ...VALID, ownerPersonId: alice.id })
    if (!metric.ok) throw new Error('fixture failed')
    assert.equal((await setEntry(db, token, metric.value.id, '2026-03-23', 3)).ok, true)
    // Retire.
    assert.equal(
      (await updateMetric(db, token, metric.value.id, {
        ...VALID,
        ownerPersonId: alice.id,
        active: false,
      })).ok,
      true,
    )
    assert.deepEqual(await setEntry(db, token, metric.value.id, '2026-03-30', 4), {
      ok: false,
      error: 'metric_inactive',
    })
    // History still readable, and the grid (active-only) drops the metric.
    const history = await listEntriesForMetric(db, token, metric.value.id)
    assert.equal(history.ok, true)
    if (history.ok) assert.equal(history.value.length, 1)
    const grid = await listEntriesForGrid(db, token, 4, '2026-04-03')
    assert.equal(grid.ok, true)
    if (grid.ok) assert.equal(grid.value.metrics.length, 0)
  })

  it('grid shape: 8 weeks × active metrics, null cells for missing entries, oldest→newest columns', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const alice = await personFor(db, token, 'Alice')
    const a = await createMetric(db, token, { ...VALID, ownerPersonId: alice.id })
    const b = await createMetric(db, token, {
      name: 'Other',
      ownerPersonId: alice.id,
      target: 1,
    })
    if (!a.ok || !b.ok) throw new Error('fixture failed')
    // a gets an entry 3 weeks back; b has none.
    assert.equal((await setEntry(db, token, a.value.id, '2026-03-06', 55)).ok, true)
    const grid = await listEntriesForGrid(db, token, 8, '2026-03-27')
    assert.equal(grid.ok, true)
    if (!grid.ok) throw new Error('grid failed')
    assert.equal(grid.value.weeks.length, 8)
    assert.equal(grid.value.weeks[0]!.monday, '2026-02-02') // Mon of week -7
    assert.equal(grid.value.weeks[7]!.monday, '2026-03-23') // current week's Mon
    assert.equal(grid.value.weeks[7]!.label, 'Week of Mar 23')
    const rowA = grid.value.metrics.find((m) => m.id === a.value.id)!
    const rowB = grid.value.metrics.find((m) => m.id === b.value.id)!
    assert.equal(rowA.cells.filter((c) => c.actual != null).length, 1)
    // Entry week 2026-03-02 = index 4 (weeks run 02-02 … 03-23).
    assert.equal(rowA.cells[4]!.actual, 55)
    assert.equal(rowA.cells[4]!.pass, false) // 55 >= 50000 fails
    assert.equal(rowB.cells.filter((c) => c.actual != null).length, 0)
    assert.ok(rowB.cells.every((c) => c.pass === null))
  })

  it('entry validation: non-finite actual rejected without persisting; unknown metric not_found', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)
    const alice = await personFor(db, token, 'Alice')
    const metric = await createMetric(db, token, { ...VALID, ownerPersonId: alice.id })
    if (!metric.ok) throw new Error('fixture failed')
    assert.deepEqual(await setEntry(db, token, metric.value.id, '2026-03-23', 'abc'), {
      ok: false,
      error: 'invalid_actual',
    })
    assert.deepEqual(await setEntry(db, token, metric.value.id, '2026-03-23', Infinity), {
      ok: false,
      error: 'invalid_actual',
    })
    assert.deepEqual(await setEntry(db, token, 999, '2026-03-23', 1), {
      ok: false,
      error: 'not_found',
    })
    assert.deepEqual(await listEntriesForMetric(db, token, 999), { ok: false, error: 'not_found' })
  })
})
