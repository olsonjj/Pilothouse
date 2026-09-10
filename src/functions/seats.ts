import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { getDb } from '../server/db'
import { SESSION_COOKIE } from '../server/auth'
import {
  createSeat,
  updateSeat,
  createAssignment,
  endAssignment,
  listSeats,
  getSeat,
  getPersonAssignments,
  type SeatInput,
  type AssignmentInput,
} from '../server/seats'

/** Thin cookie-layer wrappers around src/server/seats.ts. */

export const listSeatsFn = createServerFn({ method: 'GET' }).handler(async () => {
  const db = await getDb()
  return listSeats(db, getCookie(SESSION_COOKIE))
})

export const getSeatFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => d as { seatId?: number })
  .handler(async ({ data }) => {
    const db = await getDb()
    return getSeat(db, getCookie(SESSION_COOKIE), data.seatId ?? 0)
  })

export const getPersonAssignmentsFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => d as { personId?: number })
  .handler(async ({ data }) => {
    const db = await getDb()
    return getPersonAssignments(db, getCookie(SESSION_COOKIE), data.personId ?? 0)
  })

export const createSeatFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    d as {
      name?: string
      description?: string | null
      responsibilities?: string[]
      parentSeatId?: number | null
      sortOrder?: number
    },
  )
  .handler(async ({ data }) => {
    const db = await getDb()
    const input: SeatInput = {
      name: data.name ?? '',
      description: data.description ?? null,
      responsibilities: data.responsibilities ?? [],
      parentSeatId: data.parentSeatId ?? null,
      sortOrder: data.sortOrder,
    }
    return createSeat(db, getCookie(SESSION_COOKIE), input)
  })

export const updateSeatFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    d as {
      seatId?: number
      name?: string
      description?: string | null
      responsibilities?: string[]
      parentSeatId?: number | null
      sortOrder?: number
    },
  )
  .handler(async ({ data }) => {
    const db = await getDb()
    const input: SeatInput = {
      name: data.name ?? '',
      description: data.description ?? null,
      responsibilities: data.responsibilities ?? [],
      parentSeatId: data.parentSeatId ?? null,
      sortOrder: data.sortOrder,
    }
    return updateSeat(db, getCookie(SESSION_COOKIE), data.seatId ?? 0, input)
  })

export const createAssignmentFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { personId?: number; seatId?: number; startDate?: string })
  .handler(async ({ data }) => {
    const db = await getDb()
    const input: AssignmentInput = {
      personId: data.personId ?? 0,
      seatId: data.seatId ?? 0,
      startDate: data.startDate,
    }
    return createAssignment(db, getCookie(SESSION_COOKIE), input)
  })

export const endAssignmentFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { assignmentId?: number; endDate?: string })
  .handler(async ({ data }) => {
    const db = await getDb()
    return endAssignment(db, getCookie(SESSION_COOKIE), data.assignmentId ?? 0, data.endDate)
  })