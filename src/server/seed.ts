import type { Db } from './db'
import { users } from './schema'
import { hashPassword } from './auth'

export const OWNER_EMAIL = 'owner@openeos.local'
export const DEFAULT_OWNER_PASSWORD = 'openeos-owner-dev'

/**
 * On first run, create the owner admin account. Password comes from
 * OPENEOS_OWNER_PASSWORD if set; otherwise a documented dev-only default is
 * used (safe because the database is local-only, but change it for anything
 * exposed beyond localhost).
 */
export async function seedOwner(db: Db): Promise<void> {
  const existing = await db.select({ id: users.id }).from(users).get()
  if (existing) return
  const password = process.env.OPENEOS_OWNER_PASSWORD ?? DEFAULT_OWNER_PASSWORD
  if (!process.env.OPENEOS_OWNER_PASSWORD) {
    console.log(
      `[openeos] Seeded owner admin ${OWNER_EMAIL} with the default dev password ` +
        `(set OPENEOS_OWNER_PASSWORD to override — see README).`,
    )
  }
  await db.insert(users).values({
    email: OWNER_EMAIL,
    passwordHash: hashPassword(password),
    name: 'Owner',
    role: 'admin',
  })
}