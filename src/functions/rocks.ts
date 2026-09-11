import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { getDb } from '../server/db'
import { SESSION_COOKIE } from '../server/auth'
import {
  createRock,
  updateRock,
  listRocks,
  setStatus,
  listStatusesForRocks,
  type RockInput,
} from '../server/rocks'

/** Thin cookie-layer wrappers around src/server/rocks.ts. */

export const listRocksFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => d as { quarterId?: number })
  .handler(async ({ data }) => {
    const db = await getDb()
    return listRocks(db, getCookie(SESSION_COOKIE), data?.quarterId ?? 0)
  })

export const createRockFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    d as {
      statement?: string
      detail?: string | null
      ownerPersonId?: number | null
      quarterId?: number
      target?: number | null
      direction?: 'gte' | 'lte' | null
    },
  )
  .handler(async ({ data }) => {
    const db = await getDb()
    const input: RockInput = {
      statement: data.statement ?? '',
      detail: data.detail ?? null,
      ownerPersonId: data.ownerPersonId ?? null,
      quarterId: data.quarterId ?? 0,
      target: data.target ?? null,
      direction: data.direction ?? null,
    }
    return createRock(db, getCookie(SESSION_COOKIE), input)
  })

export const updateRockFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    d as {
      rockId?: number
      statement?: string
      detail?: string | null
      target?: number | null
      direction?: 'gte' | 'lte' | null
    },
  )
  .handler(async ({ data }) => {
    const db = await getDb()
    return updateRock(db, getCookie(SESSION_COOKIE), data.rockId ?? 0, {
      statement: data.statement,
      detail: data.detail,
      target: data.target,
      direction: data.direction,
    })
  })
export const setStatusFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    d as { rockId?: number; week?: string; status?: string; actual?: unknown; comment?: string | null },
  )
  .handler(async ({ data }) => {
    const db = await getDb()
    return setStatus(db, getCookie(SESSION_COOKIE), data.rockId ?? 0, data.week ?? '', {
      status: data.status as 'on_track' | 'off_track' | 'measuring',
      actual: data.actual,
      comment: data.comment ?? null,
    })
  })

export const listStatusesFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => d as { quarterId?: number })
  .handler(async ({ data }) => {
    const db = await getDb()
    return listStatusesForRocks(db, getCookie(SESSION_COOKIE), data?.quarterId ?? 0)
  })
