import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { getDb } from '../server/db'
import { SESSION_COOKIE } from '../server/auth'
import {
  createPerson,
  updatePerson,
  listPeople,
  listUnlinkedUsers,
  linkUserToPerson,
  unlinkUser,
  type PersonInput,
} from '../server/people'

/** Thin cookie-layer wrappers around src/server/people.ts. */

export const listPeopleFn = createServerFn({ method: 'GET' }).handler(async () => {
  const db = await getDb()
  return listPeople(db, getCookie(SESSION_COOKIE))
})

export const listUnlinkedUsersFn = createServerFn({ method: 'GET' }).handler(async () => {
  const db = await getDb()
  return listUnlinkedUsers(db, getCookie(SESSION_COOKIE))
})

export const createPersonFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { fullName?: string; email?: string | null; startDate?: string | null })
  .handler(async ({ data }) => {
    const db = await getDb()
    const input: PersonInput = {
      fullName: data.fullName ?? '',
      email: data.email ?? null,
      startDate: data.startDate ?? null,
    }
    return createPerson(db, getCookie(SESSION_COOKIE), input)
  })

export const updatePersonFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    d as { id?: number; fullName?: string; email?: string | null; startDate?: string | null },
  )
  .handler(async ({ data }) => {
    const db = await getDb()
    const input: PersonInput = {
      fullName: data.fullName ?? '',
      email: data.email ?? null,
      startDate: data.startDate ?? null,
    }
    return updatePerson(db, getCookie(SESSION_COOKIE), data.id ?? 0, input)
  })

export const linkUserFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { userId?: number; personId?: number })
  .handler(async ({ data }) => {
    const db = await getDb()
    return linkUserToPerson(db, getCookie(SESSION_COOKIE), data.userId ?? 0, data.personId ?? 0)
  })

export const unlinkUserFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { userId?: number })
  .handler(async ({ data }) => {
    const db = await getDb()
    return unlinkUser(db, getCookie(SESSION_COOKIE), data.userId ?? 0)
  })