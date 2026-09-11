import type { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_INTERVAL_HOURS = 12

/**
 * Write a snapshot of the live database via SQLite's VACUUM INTO
 * (per data-model.md: local snapshots are the v1 backup strategy).
 * Returns the backup file path.
 */
export function backupNow(sqlite: DatabaseSync, dbFile: string, backupDir?: string): string {
  const dir = backupDir ?? path.join(path.dirname(dbFile), 'backups')
  fs.mkdirSync(dir, { recursive: true })
  let target = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.db`)
  // Successive snapshots within the same millisecond must not collide.
  for (let i = 1; fs.existsSync(target); i++) {
    target = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${i}.db`)
  }
  sqlite.exec(`VACUUM INTO '${target}'`)
  return target
}

/** Interval-based snapshot job; started once alongside the app's DB singleton. */
export function scheduleBackups(
  sqlite: DatabaseSync,
  dbFile: string,
  opts?: { intervalHours?: number },
): void {
  const intervalHours =
    opts?.intervalHours ??
    (Number(process.env.PILOTHOUSE_BACKUP_INTERVAL_HOURS) || DEFAULT_INTERVAL_HOURS)
  backupNow(sqlite, dbFile) // snapshot at server start too
  const timer = setInterval(() => {
    try {
      backupNow(sqlite, dbFile)
    } catch (err) {
      console.error('[Pilothouse] scheduled backup failed:', err)
    }
  }, intervalHours * 60 * 60 * 1000)
  timer.unref()
}