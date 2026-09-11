import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { getDb } from '../server/db'
import { SESSION_COOKIE } from '../server/auth'
import { listScores, setScore } from '../server/peopleAnalyzer'

/** Thin cookie-layer wrappers around src/server/peopleAnalyzer.ts. */

export const getAnalyzerFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => d as { quarterId?: number })
  .handler(async ({ data }) => {
    const db = await getDb()
    return listScores(db, getCookie(SESSION_COOKIE), data?.quarterId ?? 0)
  })

export const setScoreFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    d as {
      personId?: number
      quarterId?: number
      coreValueId?: number
      score?: string
    },
  )
  .handler(async ({ data }) => {
    const db = await getDb()
    return setScore(db, getCookie(SESSION_COOKIE), {
      personId: data?.personId ?? 0,
      quarterId: data?.quarterId ?? 0,
      coreValueId: data?.coreValueId ?? 0,
      score: data?.score ?? '',
    })
  })