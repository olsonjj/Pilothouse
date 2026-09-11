import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { getDb } from '../server/db'
import { SESSION_COOKIE } from '../server/auth'
import { createMetric, updateMetric, listMetrics, listEntriesForGrid, setEntry, type MetricInput } from '../server/metrics'

/** Thin cookie-layer wrappers around src/server/metrics.ts. */

export const listMetricsFn = createServerFn({ method: 'GET' }).handler(async () => {
  const db = await getDb()
  return listMetrics(db, getCookie(SESSION_COOKIE))
})

export const listAllMetricsFn = createServerFn({ method: 'GET' }).handler(async () => {
  const db = await getDb()
  return listMetrics(db, getCookie(SESSION_COOKIE), true)
})

export const createMetricFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as Partial<MetricInput>)
  .handler(async ({ data }) => {
    const db = await getDb()
    const input: MetricInput = {
      name: data.name ?? '',
      ownerPersonId: data.ownerPersonId ?? 0,
      target: data.target as number,
      direction: data.direction,
      unit: data.unit ?? null,
      active: data.active,
    }
    return createMetric(db, getCookie(SESSION_COOKIE), input)
  })

export const updateMetricFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as Partial<MetricInput> & { id?: number })
  .handler(async ({ data }) => {
    const db = await getDb()
    const input: MetricInput = {
      name: data.name ?? '',
      ownerPersonId: data.ownerPersonId ?? 0,
      target: data.target as number,
      direction: data.direction,
      unit: data.unit ?? null,
      active: data.active,
    }
    return updateMetric(db, getCookie(SESSION_COOKIE), data.id ?? 0, input)
  })
export const listGridFn = createServerFn({ method: 'GET' }).handler(async () => {
  const db = await getDb()
  return listEntriesForGrid(db, getCookie(SESSION_COOKIE))
})

export const setEntryFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { metricId?: number; week?: string; actual?: string | number })
  .handler(async ({ data }) => {
    const db = await getDb()
    return setEntry(db, getCookie(SESSION_COOKIE), data.metricId ?? 0, data.week ?? '', data.actual)
  })
