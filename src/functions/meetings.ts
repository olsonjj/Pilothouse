import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { getDb } from '../server/db'
import { SESSION_COOKIE } from '../server/auth'
import {
  startMeeting,
  getMeeting,
  getOpenMeeting,
  advanceSegment,
  deleteMeeting,
  setFacilitator,
  listMeetings,
  getPreloadedData,
} from '../server/meetings'

/** Thin cookie-layer wrappers around src/server/meetings.ts. */

export const startMeetingFn = createServerFn({ method: 'POST' }).handler(async () => {
  const db = await getDb()
  return startMeeting(db, getCookie(SESSION_COOKIE))
})

export const getOpenMeetingFn = createServerFn({ method: 'GET' }).handler(async () => {
  const db = await getDb()
  return getOpenMeeting(db, getCookie(SESSION_COOKIE))
})

export const getMeetingFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => d as { meetingId?: number })
  .handler(async ({ data }) => {
    const db = await getDb()
    return getMeeting(db, getCookie(SESSION_COOKIE), data.meetingId ?? 0)
  })

export const advanceSegmentFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { meetingId?: number; segmentId?: number })
  .handler(async ({ data }) => {
    const db = await getDb()
    return advanceSegment(db, getCookie(SESSION_COOKIE), data.meetingId ?? 0, data.segmentId ?? 0)
  })

export const deleteMeetingFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { meetingId?: number })
  .handler(async ({ data }) => {
    const db = await getDb()
    return deleteMeeting(db, getCookie(SESSION_COOKIE), data.meetingId ?? 0)
  })

export const setFacilitatorFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { meetingId?: number; personId?: number | null })
  .handler(async ({ data }) => {
    const db = await getDb()
    return setFacilitator(db, getCookie(SESSION_COOKIE), data.meetingId ?? 0, data.personId ?? null)
  })

export const listMeetingsFn = createServerFn({ method: 'GET' }).handler(async () => {
  const db = await getDb()
  return listMeetings(db, getCookie(SESSION_COOKIE))
})

export const getPreloadedDataFn = createServerFn({ method: 'GET' }).handler(async () => {
  const db = await getDb()
  return getPreloadedData(db, getCookie(SESSION_COOKIE))
})