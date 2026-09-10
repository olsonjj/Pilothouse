import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { getDb } from '../server/db'
import { SESSION_COOKIE } from '../server/auth'
import {
  listCoreValues,
  createCoreValue,
  updateCoreValue,
  reorderCoreValues,
  type CoreValueInput,
  type CoreValueUpdate,
} from '../server/coreValues'

/** Thin cookie-layer wrappers around src/server/coreValues.ts. */

export const listCoreValuesFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => (d ?? {}) as { includeInactive?: boolean })
  .handler(async ({ data }) => {
    const db = await getDb()
    return listCoreValues(db, getCookie(SESSION_COOKIE), data?.includeInactive === true)
  })

export const createCoreValueFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as Partial<CoreValueInput>)
  .handler(async ({ data }) => {
    const db = await getDb()
    return createCoreValue(db, getCookie(SESSION_COOKIE), {
      name: data?.name ?? '',
      description: data?.description ?? null,
    })
  })

export const updateCoreValueFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { id?: number } & CoreValueUpdate)
  .handler(async ({ data }) => {
    const db = await getDb()
    return updateCoreValue(db, getCookie(SESSION_COOKIE), data?.id ?? 0, {
      name: data?.name,
      description: data?.description,
      active: data?.active,
    })
  })

export const reorderCoreValuesFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { orderedIds?: number[] })
  .handler(async ({ data }) => {
    const db = await getDb()
    return reorderCoreValues(db, getCookie(SESSION_COOKIE), data?.orderedIds ?? [])
  })