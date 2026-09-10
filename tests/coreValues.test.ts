import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  listCoreValues,
  createCoreValue,
  updateCoreValue,
  reorderCoreValues,
} from '#/server/coreValues'
import { createTestDb, signedInUser } from './helpers'

describe('core values CRUD', () => {
  it('admin creates values; active-only list is ordered by sort_order', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)

    const a = await createCoreValue(db, token, { name: 'Integrity', description: 'Do the right thing' })
    const b = await createCoreValue(db, token, { name: 'Simplicity' })
    assert.equal(a.ok, true)
    assert.equal(b.ok, true)

    const list = await listCoreValues(db, token)
    assert.equal(list.ok, true)
    if (list.ok) {
      assert.deepEqual(
        list.value.map((v) => v.name),
        ['Integrity', 'Simplicity'], // creation order = append to end
      )
      assert.deepEqual(list.value.map((v) => v.sortOrder), [0, 1])
    }
  })

  it('empty/whitespace name rejected; duplicate name (case-insensitive) rejected', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)

    assert.deepEqual(await createCoreValue(db, token, { name: '   ' }), {
      ok: false,
      error: 'name_required',
    })
    const created = await createCoreValue(db, token, { name: 'Integrity' })
    assert.equal(created.ok, true)
    assert.deepEqual(await createCoreValue(db, token, { name: 'integrity' }), {
      ok: false,
      error: 'name_taken',
    })
    // DB-level index backs the app check (raw insert would throw).
  })

  it('members can list but not create/edit/reorder; unauthenticated denied', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db) // admin
    const member = await signedInUser(db, 'member')

    assert.deepEqual(await listCoreValues(db, member.token), { ok: true, value: [] })
    assert.deepEqual(await createCoreValue(db, member.token, { name: 'X' }), {
      ok: false,
      error: 'forbidden',
    })
    assert.deepEqual(await reorderCoreValues(db, member.token, []), {
      ok: false,
      error: 'forbidden',
    })

    const created = await createCoreValue(db, token, { name: 'Focus' })
    if (!created.ok) throw new Error('fixture failed')
    assert.deepEqual(await updateCoreValue(db, member.token, created.value.id, { active: false }), {
      ok: false,
      error: 'forbidden',
    })

    assert.deepEqual(await listCoreValues(db, undefined), { ok: false, error: 'unauthenticated' })
  })

  it('rename keeps the row id (stable IDs); edit persists description', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)

    const created = await createCoreValue(db, token, { name: 'We are builders' })
    if (!created.ok) throw new Error('fixture failed')
    const originalId = created.value.id

    const renamed = await updateCoreValue(db, token, originalId, {
      name: 'We are shipwrights',
      description: 'Renamed for clarity',
    })
    assert.equal(renamed.ok, true)
    if (renamed.ok) {
      assert.equal(renamed.value.id, originalId, 'ID must not change on rename')
      assert.equal(renamed.value.name, 'We are shipwrights')
      assert.equal(renamed.value.description, 'Renamed for clarity')
    }
  })

  it('deactivation keeps the row, hides it from the default list, keeps id on reactivate', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)

    const created = await createCoreValue(db, token, { name: 'Stewardship' })
    if (!created.ok) throw new Error('fixture failed')
    const id = created.value.id

    const deactivated = await updateCoreValue(db, token, id, { active: false })
    assert.equal(deactivated.ok, true)
    if (deactivated.ok) assert.equal(deactivated.value.active, 0)

    // Default list hides it; includeInactive shows it (same row, same id).
    const activeOnly = await listCoreValues(db, token)
    if (activeOnly.ok) assert.equal(activeOnly.value.some((v) => v.id === id), false)
    const withInactive = await listCoreValues(db, token, true)
    if (withInactive.ok) assert.equal(withInactive.value.some((v) => v.id === id), true)

    const reactivated = await updateCoreValue(db, token, id, { active: true })
    assert.equal(reactivated.ok, true)
    if (reactivated.ok) assert.equal(reactivated.value.id, id)
  })
})

describe('core values reorder', () => {
  it('round-trip: reorder assigns contiguous 0..n-1 and list follows the new order', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)

    const a = await createCoreValue(db, token, { name: 'A' })
    const b = await createCoreValue(db, token, { name: 'B' })
    const c = await createCoreValue(db, token, { name: 'C' })
    if (!a.ok || !b.ok || !c.ok) throw new Error('fixture failed')

    assert.deepEqual(await reorderCoreValues(db, token, [c.value.id, a.value.id, b.value.id]), {
      ok: true,
      value: true,
    })

    const list = await listCoreValues(db, token)
    if (list.ok) {
      assert.deepEqual(
        list.value.map((v) => v.name),
        ['C', 'A', 'B'],
      )
      assert.deepEqual(
        list.value.map((v) => v.sortOrder),
        [0, 1, 2],
      )
    }
  })

  it('reorder rejects duplicates, unknown ids, and empty list without side effects', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db)

    const a = await createCoreValue(db, token, { name: 'A' })
    const b = await createCoreValue(db, token, { name: 'B' })
    if (!a.ok || !b.ok) throw new Error('fixture failed')

    assert.deepEqual(await reorderCoreValues(db, token, [a.value.id, a.value.id]), {
      ok: false,
      error: 'invalid_order',
    })
    assert.deepEqual(await reorderCoreValues(db, token, [a.value.id, 999]), {
      ok: false,
      error: 'invalid_order',
    })
    assert.deepEqual(await reorderCoreValues(db, token, []), { ok: false, error: 'invalid_order' })

    // Nothing changed.
    const list = await listCoreValues(db, token)
    if (list.ok) assert.deepEqual(list.value.map((v) => v.name), ['A', 'B'])
  })

  it('includeInactive list is admin-only; members get forbidden', async () => {
    const { db } = await createTestDb()
    const { token } = await signedInUser(db) // admin
    const member = await signedInUser(db, 'member')
    assert.equal((await createCoreValue(db, token, { name: 'X', description: null })).ok, true)
    assert.equal((await updateCoreValue(db, token, 1, { name: 'X', description: null, active: false })).ok, true)

    // Admin sees inactive rows explicitly; member denied entirely.
    const adminList = await listCoreValues(db, token, true)
    assert.equal(adminList.ok, true)
    if (adminList.ok) assert.equal(adminList.value.length, 1)
    assert.deepEqual(await listCoreValues(db, member.token, true), {
      ok: false,
      error: 'forbidden',
    })
    // Member's default list still works (active only).
    const memberDefault = await listCoreValues(db, member.token)
    assert.equal(memberDefault.ok, true)
    if (memberDefault.ok) assert.deepEqual(memberDefault.value, [])
  })
})