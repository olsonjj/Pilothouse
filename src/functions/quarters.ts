import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { getDb } from '../server/db'
import { SESSION_COOKIE } from '../server/auth'
import { getCurrentPeriod, listQuarters } from '../server/quarters'

/** Thin cookie-layer wrappers around src/server/quarters.ts. */

export const getCurrentPeriodFn = createServerFn({ method: 'GET' }).handler(async () => {
  const db = await getDb()
  return getCurrentPeriod(db, getCookie(SESSION_COOKIE))
})

export const listQuartersFn = createServerFn({ method: 'GET' }).handler(async () => {
  const db = await getDb()
  return listQuarters(db, getCookie(SESSION_COOKIE))
})