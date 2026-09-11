import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { getDb } from '../server/db'
import { SESSION_COOKIE } from '../server/auth'
import {
  createUser,
  resetPassword,
  setRole,
  listUsers,
  type NewUserInput,
} from '../server/userManagement'

/** Thin cookie-layer wrappers around src/server/userManagement.ts. */

export const listUsersFn = createServerFn({ method: 'GET' }).handler(async () => {
  const db = await getDb()
  return listUsers(db, getCookie(SESSION_COOKIE))
})

export const createUserFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    d as { email?: string; name?: string; password?: string; role?: string },
  )
  .handler(async ({ data }) => {
    const db = await getDb()
    const input: NewUserInput = {
      email: data.email ?? '',
      name: data.name ?? '',
      password: data.password ?? '',
      role: data.role === 'admin' ? 'admin' : 'member',
    }
    return createUser(db, getCookie(SESSION_COOKIE), input)
  })

export const resetPasswordFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { userId?: number; password?: string })
  .handler(async ({ data }) => {
    const db = await getDb()
    return resetPassword(db, getCookie(SESSION_COOKIE), data.userId ?? 0, data.password ?? '')
  })

export const setRoleFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { userId?: number; role?: string })
  .handler(async ({ data }) => {
    const db = await getDb()
    return setRole(
      db,
      getCookie(SESSION_COOKIE),
      data.userId ?? 0,
      data.role === 'admin' ? 'admin' : 'member',
    )
  })