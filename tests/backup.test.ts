import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { backupNow } from '#/server/backup'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { createTestDb } from './helpers'

describe('backup snapshot job', () => {
  it('writes a SQLite snapshot via VACUUM INTO into the backups dir', async () => {
    const { sqlite, dir } = await createTestDb()
    const target = backupNow(sqlite, path.join(dir, 'test.db'), path.join(dir, 'backups'))
    assert.ok(existsSync(target))
    assert.equal(readdirSync(path.join(dir, 'backups')).length, 1)
    // The source connection still sees the schema after snapshotting.
    const check = sqlite.prepare(`SELECT count(*) AS n FROM pragma_table_info('users')`)
    assert.ok((check.get() as { n: number }).n > 0)
  })

  it('names backups with timestamps so successive snapshots coexist', async () => {
    const { sqlite, dir } = await createTestDb()
    const backupDir = path.join(dir, 'backups')
    const first = backupNow(sqlite, path.join(dir, 'test.db'), backupDir)
    const second = backupNow(sqlite, path.join(dir, 'test.db'), backupDir)
    assert.notEqual(first, second)
    assert.equal(readdirSync(backupDir).length, 2)
  })
})