// Standalone backup script: writes a SQLite snapshot of the live database.
// Run manually (`pnpm backup`) or from cron/systemd for scheduled backups.
// The app also snapshots on server start and on an interval — see
// src/server/backup.ts. Uses Node's built-in node:sqlite (no native deps).
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const dbFile = process.env.OPENEOS_DB_PATH ?? path.resolve('data/openeos.db')
const backupDir = process.env.OPENEOS_BACKUP_DIR ?? path.join(path.dirname(dbFile), 'backups')

if (!fs.existsSync(dbFile)) {
  console.error(`Database not found: ${dbFile}`)
  process.exit(1)
}

fs.mkdirSync(backupDir, { recursive: true })
const target = path.join(backupDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.db`)
const sqlite = new DatabaseSync(dbFile)
sqlite.exec(`VACUUM INTO '${target}'`)
sqlite.close()
console.log(`Backup written: ${target}`)