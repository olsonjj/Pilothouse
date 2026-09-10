import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { getDb } from '../server/db'
import { SESSION_COOKIE } from '../server/auth'
import { getVto, updateVto, type VtoInput } from '../server/vto'

/** Thin cookie-layer wrappers around src/server/vto.ts. */

export const getVtoFn = createServerFn({ method: 'GET' }).handler(async () => {
  const db = await getDb()
  return getVto(db, getCookie(SESSION_COOKIE))
})

export const updateVtoFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as Partial<VtoInput>)
  .handler(async ({ data }) => {
    const db = await getDb()
    return updateVto(db, getCookie(SESSION_COOKIE), data as VtoInput)
  })