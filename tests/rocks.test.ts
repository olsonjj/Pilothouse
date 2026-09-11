import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createRock,
  updateRock,
  listRocks,
  setStatus,
  listStatusesForRocks,
  listLatestStatuses,
  ROCK_CAP,
} from '../src/server/rocks'
import { createPerson, linkUserToPerson } from '../src/server/people'
import { createTestDb, signedInUser } from './helpers'
import { todayIso } from '../src/server/week'
import { DatabaseSync } from 'node:sqlite'
import type { Db } from '../src/server/db'

/** Person fixture: creates + returns the person row. */
async function personFor(db: Db, token: string, name: string) {
  const person = await createPerson(db, token, { fullName: name })
  if (!person.ok) throw new Error('person fixture failed')
  return person.value
}

/** Member fixture: signed-in member linked to a fresh person (admin creates the person). */
async function memberWithPerson(db: Db, name: string) {
  const admin = await signedInUser(db) // members can't create people
  const member = await signedInUser(db, 'member')
  const person = await personFor(db, admin.token, name)
  assert.equal((await linkUserToPerson(db, admin.token, member.user.id, person.id)).ok, true)
  return { member, person }
}

/** Current quarter id (seeded by createTestDb). */
function currentQuarterId(sqlite: DatabaseSync): number {
  const today = new Date().toISOString().slice(0, 10)
  const row = sqlite
    .prepare('SELECT id FROM quarters WHERE start_date <= ? AND end_date >= ?')
    .get(today, today) as { id: number } | undefined
  if (!row) throw new Error('no current quarter seeded')
  return row.id
}

/** A quarter whose end_date is in the past (seed directly). */
function seedPastQuarter(sqlite: DatabaseSync): number {
  sqlite.exec(
    "INSERT INTO quarters (label, start_date, end_date) VALUES ('2020 Q1', '2020-01-01', '2020-03-31')",
  )
  const row = sqlite.prepare("SELECT id FROM quarters WHERE label = '2020 Q1'").get() as {
    id: number
  }
  return row.id
}

describe('Rocks: create & manage (seam, ticket 17)', () => {
  it('admin creates a company rock (owner null) — round-trips with owner name', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    const qid = currentQuarterId(sqlite)
    const result = await createRock(db, token, {
      statement: 'Ship the new website by Jun 15',
      detail: 'Marketing priority',
      quarterId: qid,
    })
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.value.statement, 'Ship the new website by Jun 15')
      assert.equal(result.value.detail, 'Marketing priority')
      assert.equal(result.value.ownerPersonId, null)
      assert.equal(result.value.target, null)
      assert.equal(result.value.direction, null)
      assert.equal('warning' in result, false)
    }
  })

  it('admin creates a personal rock for anyone; member only for themselves', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db) // admin
    const alice = await personFor(db, token, 'Alice')
    const { member, person: bob } = await memberWithPerson(db, 'Bob')

    // Admin personal rock for Alice.
    const forAlice = await createRock(db, token, {
      statement: 'Alice ships onboarding',
      ownerPersonId: alice.id,
      quarterId: currentQuarterId(sqlite),
    })
    assert.equal(forAlice.ok, true)
    if (forAlice.ok) assert.equal(forAlice.value.ownerPersonId, alice.id)

    // Member self rock.
    const self = await createRock(db, member.token, {
      statement: 'Bob learns Drizzle',
      ownerPersonId: bob.id,
      quarterId: currentQuarterId(sqlite),
    })
    assert.equal(self.ok, true)

    // Member rock for someone else → forbidden.
    assert.deepEqual(
      await createRock(db, member.token, {
        statement: 'not mine',
        ownerPersonId: alice.id,
        quarterId: currentQuarterId(sqlite),
      }),
      { ok: false, error: 'forbidden' },
    )

    // Member company rock (null owner) → forbidden.
    assert.deepEqual(
      await createRock(db, member.token, {
        statement: 'company attempt',
        quarterId: currentQuarterId(sqlite),
      }),
      { ok: false, error: 'forbidden' },
    )
  })

  it('cap warning fires on the 8th company rock and 8th personal rock; 7th is silent; never blocks', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    const qid = currentQuarterId(sqlite)
    const alice = await personFor(db, token, 'Alice')

    // 7 company rocks: no warning.
    for (let i = 1; i <= ROCK_CAP; i++) {
      const r = await createRock(db, token, { statement: `company ${i}`, quarterId: qid })
      assert.equal(r.ok, true)
      assert.equal('warning' in r, false)
    }
    // 8th: warning present, still ok.
    const eighth = await createRock(db, token, { statement: 'company 8', quarterId: qid })
    assert.equal(eighth.ok, true)
    assert.equal('warning' in eighth && eighth.warning, 'over_rock_cap')

    // Personal: 7 for Alice silent, 8th warns. (Company rocks don't count.)
    for (let i = 1; i <= ROCK_CAP; i++) {
      const r = await createRock(db, token, {
        statement: `alice ${i}`,
        ownerPersonId: alice.id,
        quarterId: qid,
      })
      assert.equal(r.ok, true)
      assert.equal('warning' in r, false)
    }
    const eighthPersonal = await createRock(db, token, {
      statement: 'alice 8',
      ownerPersonId: alice.id,
      quarterId: qid,
    })
    assert.equal(eighthPersonal.ok, true)
    assert.equal('warning' in eighthPersonal && eighthPersonal.warning, 'over_rock_cap')
  })

  it('target/direction must co-occur: target alone, direction alone rejected; both and neither ok', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    const qid = currentQuarterId(sqlite)

    assert.deepEqual(
      await createRock(db, token, {
        statement: 'target only',
        quarterId: qid,
        target: 100,
      }),
      { ok: false, error: 'target_direction_mismatch' },
    )
    assert.deepEqual(
      await createRock(db, token, {
        statement: 'direction only',
        quarterId: qid,
        direction: 'gte',
      }),
      { ok: false, error: 'target_direction_mismatch' },
    )
    const both = await createRock(db, token, {
      statement: 'both',
      quarterId: qid,
      target: 25,
      direction: 'lte',
    })
    assert.equal(both.ok, true)
    if (both.ok) {
      assert.equal(both.value.target, 25)
      assert.equal(both.value.direction, 'lte')
    }
    const neither = await createRock(db, token, { statement: 'binary', quarterId: qid })
    assert.equal(neither.ok, true)
  })

  it('writes to past quarters are rejected as read-only history', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    const pastId = seedPastQuarter(sqlite)

    assert.deepEqual(
      await createRock(db, token, { statement: 'time travel', quarterId: pastId }),
      { ok: false, error: 'quarter_read_only' },
    )
    // Even updating a rock that somehow sits in a past quarter.
    sqlite.exec(
      `INSERT INTO rocks (statement, quarter_id, created_by, created_at, updated_at)
       VALUES ('legacy', ${pastId}, 1, '2020-02-01T00:00:00Z', '2020-02-01T00:00:00Z')`,
    )
    const legacyId = (sqlite.prepare('SELECT id FROM rocks WHERE statement = ?').get('legacy') as { id: number }).id
    assert.deepEqual(await updateRock(db, token, legacyId, { statement: 'edit legacy' }), {
      ok: false,
      error: 'quarter_read_only',
    })

    // BOUNDARY PIN: a quarter ending TODAY is still writable (strict <).
    const today = todayIso()
    sqlite.exec(
      `INSERT INTO quarters (label, start_date, end_date) VALUES ('2020 Q2', date('${today}', '-3 months'), '${today}')`,
    )
    const endingTodayId = (
      sqlite.prepare("SELECT id FROM quarters WHERE label = '2020 Q2'").get() as { id: number }
    ).id
    const boundary = await createRock(db, token, { statement: 'last day rock', quarterId: endingTodayId })
    assert.equal(boundary.ok, true)
  })

  it('update: admin any rock, member own only; quarter immutable; co-occurrence merged', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db) // admin
    const qid = currentQuarterId(sqlite)
    const alice = await personFor(db, token, 'Alice')
    const { member, person: bob } = await memberWithPerson(db, 'Bob')

    const adminRock = await createRock(db, token, { statement: 'admin rock', quarterId: qid })
    const bobRock = await createRock(db, member.token, {
      statement: 'bob rock',
      ownerPersonId: bob.id,
      quarterId: qid,
    })
    if (!adminRock.ok || !bobRock.ok) throw new Error('fixture failed')

    // Member edits own rock: ok.
    const selfEdit = await updateRock(db, member.token, bobRock.value.id, {
      statement: 'bob rock (edited)',
    })
    assert.equal(selfEdit.ok, true)

    // Member edits someone else's rock → forbidden.
    assert.deepEqual(await updateRock(db, member.token, adminRock.value.id, { statement: 'nope' }), {
      ok: false,
      error: 'forbidden',
    })

    // Admin edits Alice's rock: ok.
    const aliceRock = await createRock(db, token, {
      statement: 'alice rock',
      ownerPersonId: alice.id,
      quarterId: qid,
    })
    if (!aliceRock.ok) throw new Error('fixture failed')
    assert.equal((await updateRock(db, token, aliceRock.value.id, { detail: 'now with detail' })).ok, true)

    // Quarter immutable: updateRock has no quarterId input by type; merged
    // co-occurrence: adding a target to a binary rock without direction fails.
    assert.deepEqual(
      await updateRock(db, token, bobRock.value.id, { target: 10 }),
      { ok: false, error: 'target_direction_mismatch' },
    )
    const withBoth = await updateRock(db, token, bobRock.value.id, {
      target: 10,
      direction: 'gte',
    })
    assert.equal(withBoth.ok, true)
  })

  it('validation rejects with no persistence: empty statement, unknown quarter, unknown owner', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    const qid = currentQuarterId(sqlite)

    assert.deepEqual(
      await createRock(db, token, { statement: '   ', quarterId: qid }),
      { ok: false, error: 'statement_required' },
    )
    assert.deepEqual(
      await createRock(db, token, { statement: 'ghost quarter', quarterId: 9999 }),
      { ok: false, error: 'quarter_not_found' },
    )
    assert.deepEqual(
      await createRock(db, token, {
        statement: 'ghost owner',
        ownerPersonId: 424242,
        quarterId: qid,
      }),
      { ok: false, error: 'owner_not_found' },
    )
    assert.equal((sqlite.prepare('SELECT COUNT(*) c FROM rocks').get() as { c: number }).c, 0)
  })

  it('unauthenticated actions are denied', async () => {
    const { db, sqlite } = await createTestDb()
    const qid = currentQuarterId(sqlite)
    assert.deepEqual(
      await createRock(db, undefined, { statement: 'x', quarterId: qid }),
      { ok: false, error: 'unauthenticated' },
    )
    assert.equal((await listRocks(db, undefined, qid)).ok, false)
    assert.equal((await updateRock(db, undefined, 1, { statement: 'x' })).ok, false)
  })

  it('listRocks groups company vs personal with owner names', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    const qid = currentQuarterId(sqlite)
    const alice = await personFor(db, token, 'Alice')

    await createRock(db, token, { statement: 'company one', quarterId: qid })
    await createRock(db, token, {
      statement: 'alice one',
      ownerPersonId: alice.id,
      quarterId: qid,
    })

    const result = await listRocks(db, token, qid)
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.value.company.length, 1)
      assert.equal(result.value.company[0].ownerName, null)
      assert.equal(result.value.personal.length, 1)
      assert.equal(result.value.personal[0].ownerName, 'Alice')
    }
  })
})
describe('Rock weekly statuses (seam, ticket 18)', () => {
  async function rockFor(
    db: Parameters<typeof createRock>[0],
    sqlite: DatabaseSync,
    token: string,
    statement: string,
    opts?: { target?: number; direction?: 'gte' | 'lte'; ownerPersonId?: number | null },
  ) {
    const result = await createRock(db, token, {
      statement,
      quarterId: currentQuarterId(sqlite),
      ownerPersonId: opts?.ownerPersonId ?? null,
      target: opts?.target ?? null,
      direction: opts?.direction ?? null,
    })
    if (!result.ok) throw new Error('rock fixture failed')
    return result.value
  }

  it('setStatus round-trips; overwrite replaces (same row id) via UNIQUE(rock_id, week)', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    // Targeted rock so the measuring overwrite below is valid.
    const rock = await rockFor(db, sqlite, token, 'ship the thing', { target: 10, direction: 'gte' })

    const first = await setStatus(db, token, rock.id, '2026-03-25', {
      status: 'on_track',
      comment: 'moving',
    })
    assert.equal(first.ok, true)
    if (!first.ok) throw new Error('setStatus failed')
    assert.equal(first.value.week, '2026-03-23') // normalized to Monday
    assert.equal(first.value.status, 'on_track')
    assert.equal(first.value.actual, null)

    // Overwrite the same week with measuring + actual.
    const second = await setStatus(db, token, rock.id, '2026-03-27', {
      status: 'measuring',
      actual: 42,
    })
    assert.equal(second.ok, true)
    if (!second.ok) throw new Error('setStatus overwrite failed')
    assert.equal(second.value.id, first.value.id, 'overwrite must reuse the row')
    assert.equal(second.value.status, 'measuring')
    assert.equal(second.value.actual, 42)
    // Old comment cleared by the overwrite (full-row replace, not merge).
    assert.equal(second.value.comment, null)
  })

  it('measuring requires target+direction AND actual; actual on binary statuses rejected', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    const binary = await rockFor(db, sqlite, token, 'binary rock')
    const measuring = await rockFor(db, sqlite, token, 'numeric rock', {
      target: 10,
      direction: 'gte',
    })

    // Binary rock can't measure (no target).
    assert.deepEqual(await setStatus(db, token, binary.id, '2026-03-25', { status: 'measuring', actual: 5 }), {
      ok: false,
      error: 'measuring_requires_target',
    })
    // Measuring rock without actual rejected.
    assert.deepEqual(await setStatus(db, token, measuring.id, '2026-03-25', { status: 'measuring' }), {
      ok: false,
      error: 'invalid_actual',
    })
    // Actual on on_track rejected (not silently ignored).
    assert.deepEqual(
      await setStatus(db, token, measuring.id, '2026-03-25', { status: 'on_track', actual: 3 }),
      { ok: false, error: 'actual_not_allowed' },
    )
    // Happy measuring path.
    assert.equal(
      (await setStatus(db, token, measuring.id, '2026-03-25', { status: 'measuring', actual: 10 })).ok,
      true,
    )
  })

  it('week normalization: any day snaps to its Monday; Sunday overwrites the same week', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    const rock = await rockFor(db, sqlite, token, 'week keys')

    const wed = await setStatus(db, token, rock.id, '2026-03-25', { status: 'on_track' })
    if (!wed.ok) throw new Error('fixture failed')
    assert.equal(wed.value.week, '2026-03-23')

    // Sunday of the same week overwrites (not a second row).
    const sun = await setStatus(db, token, rock.id, '2026-03-29', { status: 'off_track' })
    if (!sun.ok) throw new Error('overwrite failed')
    assert.equal(sun.value.week, '2026-03-23')
    assert.equal(sun.value.id, wed.value.id)

    const all = await listStatusesForRocks(db, token, rock.quarterId)
    if (!all.ok) throw new Error('list failed')
    const mine = all.value.find((h) => h.rockId === rock.id)
    assert.equal(mine?.statuses.length, 1)
  })

  it('comment is one line capped at 200 chars', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    const rock = await rockFor(db, sqlite, token, 'comment cap')

    assert.deepEqual(
      await setStatus(db, token, rock.id, '2026-03-25', { status: 'on_track', comment: 'two\nlines' }),
      { ok: false, error: 'comment_too_long' },
    )
    assert.deepEqual(
      await setStatus(db, token, rock.id, '2026-03-25', { status: 'on_track', comment: 'x'.repeat(201) }),
      { ok: false, error: 'comment_too_long' },
    )
    assert.equal(
      (await setStatus(db, token, rock.id, '2026-03-25', { status: 'on_track', comment: 'x'.repeat(200) })).ok,
      true,
    )
  })

  it('permissions: admin any, owner own, other member forbidden, unauth denied', async () => {
    const { db, sqlite } = await createTestDb()
    const { token, user } = await signedInUser(db) // admin
    const ownerPerson = await createPerson(db, token, { fullName: 'Owner' })
    const otherPerson = await createPerson(db, token, { fullName: 'Other' })
    if (!ownerPerson.ok || !otherPerson.ok) throw new Error('people fixture failed')
    const owner = await signedInUser(db, 'member')
    const other = await signedInUser(db, 'member')
    assert.equal((await linkUserToPerson(db, token, owner.user.id, ownerPerson.value.id)).ok, true)
    assert.equal((await linkUserToPerson(db, token, other.user.id, otherPerson.value.id)).ok, true)

    const rock = await rockFor(db, sqlite, token, 'owned rock', { ownerPersonId: ownerPerson.value.id })

    // Owner can set their own rock's status.
    assert.equal((await setStatus(db, owner.token, rock.id, '2026-03-25', { status: 'on_track' })).ok, true)
    // Another member forbidden.
    assert.deepEqual(await setStatus(db, other.token, rock.id, '2026-03-25', { status: 'off_track' }), {
      ok: false,
      error: 'forbidden',
    })
    // Admin any.
    assert.equal((await setStatus(db, token, rock.id, '2026-03-25', { status: 'off_track' })).ok, true)
    // Unauthenticated denied.
    assert.deepEqual(await setStatus(db, undefined, rock.id, '2026-03-25', { status: 'on_track' }), {
      ok: false,
      error: 'unauthenticated',
    })
    void user
  })

  it('past-quarter statuses rejected as read-only; a quarter ending TODAY is writable', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    const pastId = seedPastQuarter(sqlite)
    const legacy = await rockFor(db, sqlite, token, 'past rock', { ownerPersonId: null })
    sqlite.exec(`UPDATE rocks SET quarter_id = ${pastId} WHERE id = ${legacy.id}`)

    assert.deepEqual(await setStatus(db, token, legacy.id, '2026-03-25', { status: 'on_track' }), {
      ok: false,
      error: 'quarter_read_only',
    })

    // Boundary: end_date = today is still writable (strict <).
    const today = todayIso()
    sqlite.exec(
      `INSERT INTO quarters (label, start_date, end_date) VALUES ('2020 Q3', date('${today}', '-3 months'), '${today}')`,
    )
    const endingTodayId = (
      sqlite.prepare("SELECT id FROM quarters WHERE label = '2020 Q3'").get() as { id: number }
    ).id
    const boundary = await rockFor(db, sqlite, token, 'boundary rock')
    sqlite.exec(`UPDATE rocks SET quarter_id = ${endingTodayId} WHERE id = ${boundary.id}`)
    assert.equal((await setStatus(db, token, boundary.id, today, { status: 'on_track' })).ok, true)
  })

  it('two-consecutive-off-track flag: pinned with literal weeks; adjacent-week only', async () => {
    const { db, sqlite } = await createTestDb()
    const { token } = await signedInUser(db)
    const flaggedRock = await rockFor(db, sqlite, token, 'flag me')
    const calmRock = await rockFor(db, sqlite, token, 'calm')

    // Flagged: W-2 (Mar 9) and W-1 (Mar 16) both off_track, nothing in W0.
    await setStatus(db, token, flaggedRock.id, '2026-03-09', { status: 'off_track' })
    await setStatus(db, token, flaggedRock.id, '2026-03-16', { status: 'off_track' })

    // NOT flagged: two off_track but with a gap (Mar 2 and Mar 16 — not adjacent).
    await setStatus(db, token, calmRock.id, '2026-03-02', { status: 'off_track' })
    await setStatus(db, token, calmRock.id, '2026-03-16', { status: 'off_track' })

    const result = await listLatestStatuses(db, token, flaggedRock.quarterId)
    assert.equal(result.ok, true)
    if (!result.ok) throw new Error('list failed')

    const flagged = result.value.find((h) => h.rockId === flaggedRock.id)
    assert.equal(flagged?.latestWeek, '2026-03-16')
    assert.equal(flagged?.twoConsecutiveOffTrack, true)

    const calm = result.value.find((h) => h.rockId === calmRock.id)
    assert.equal(calm?.twoConsecutiveOffTrack, false)

    // History-level flag: the Mar 16 entry is flagged; the Mar 9 entry is not.
    const history = await listStatusesForRocks(db, token, flaggedRock.quarterId)
    if (!history.ok) throw new Error('history failed')
    const flaggedHistory = history.value.find((h) => h.rockId === flaggedRock.id)
    const byWeek = new Map(flaggedHistory?.statuses.map((s) => [s.week, s.twoConsecutiveOffTrack]))
    assert.equal(byWeek.get('2026-03-09'), false)
    assert.equal(byWeek.get('2026-03-16'), true)

    // Adding an on_track latest week clears the flag (W-1 on_track breaks the pair).
    await setStatus(db, token, flaggedRock.id, '2026-03-23', { status: 'on_track' })
    const after = await listLatestStatuses(db, token, flaggedRock.quarterId)
    if (!after.ok) throw new Error('after failed')
    assert.equal(after.value.find((h) => h.rockId === flaggedRock.id)?.twoConsecutiveOffTrack, false)
  })
})
