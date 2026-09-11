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
  saveSegmentNotes,
  pushToMeeting,
  pushRedCell,
  pushOffTrackRock,
  pushMissedTodo,
  pushHeadline,
  listMeetingIssues,
  removeMeetingIssue,
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
export const saveSegmentNotesFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { meetingId?: number; segmentId?: number; notes?: string })
  .handler(async ({ data }) => {
    const db = await getDb()
    return saveSegmentNotes(
      db,
      getCookie(SESSION_COOKIE),
      data.meetingId ?? 0,
      data.segmentId ?? 0,
      data.notes ?? '',
    )
  })

export const pushToMeetingFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { meetingId?: number; issueId?: number })
  .handler(async ({ data }) => {
    const db = await getDb()
    return pushToMeeting(db, getCookie(SESSION_COOKIE), data.meetingId ?? 0, data.issueId ?? 0)
  })

export const pushRedCellFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { meetingId?: number; entryId?: number })
  .handler(async ({ data }) => {
    const db = await getDb()
    return pushRedCell(db, getCookie(SESSION_COOKIE), data.meetingId ?? 0, data.entryId ?? 0)
  })

export const pushOffTrackRockFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { meetingId?: number; rockId?: number })
  .handler(async ({ data }) => {
    const db = await getDb()
    return pushOffTrackRock(db, getCookie(SESSION_COOKIE), data.meetingId ?? 0, data.rockId ?? 0)
  })

export const pushMissedTodoFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { meetingId?: number; todoId?: number })
  .handler(async ({ data }) => {
    const db = await getDb()
    return pushMissedTodo(db, getCookie(SESSION_COOKIE), data.meetingId ?? 0, data.todoId ?? 0)
  })

export const pushHeadlineFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { meetingId?: number; title?: string })
  .handler(async ({ data }) => {
    const db = await getDb()
    return pushHeadline(db, getCookie(SESSION_COOKIE), data.meetingId ?? 0, data.title ?? '')
  })

export const listMeetingIssuesFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => d as { meetingId?: number })
  .handler(async ({ data }) => {
    const db = await getDb()
    return listMeetingIssues(db, getCookie(SESSION_COOKIE), data.meetingId ?? 0)
  })

export const removeMeetingIssueFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { meetingId?: number; issueId?: number })
  .handler(async ({ data }) => {
    const db = await getDb()
    return removeMeetingIssue(db, getCookie(SESSION_COOKIE), data.meetingId ?? 0, data.issueId ?? 0)
  })
