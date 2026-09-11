import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { getDb } from '../server/db'
import { SESSION_COOKIE } from '../server/auth'
import {
  addIssue,
  updateIssue,
  resolveIssue,
  listIssues,
  issueFromRock,
  issueFromScorecardEntry,
  issueFromTodo,
  listUnresolvedForCarry,
  carryLongTermIssue,
  carryUnresolvedLongTermIssues,
  type IssueInput,
  type ListIssuesInput,
} from '../server/issues'

/** Thin cookie-layer wrappers around src/server/issues.ts. */

export const listIssuesFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) =>
    d as { classification?: 'long_term' | 'short_term'; includeResolved?: boolean },
  )
  .handler(async ({ data }) => {
    const db = await getDb()
    const input: ListIssuesInput = {
      classification: data?.classification,
      includeResolved: data?.includeResolved,
    }
    return listIssues(db, getCookie(SESSION_COOKIE), input)
  })

export const addIssueFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { title?: string; classification?: string; quarterId?: number | null })
  .handler(async ({ data }) => {
    const db = await getDb()
    const input: IssueInput = {
      title: data.title ?? '',
      // Strict passthrough: garbage classifications must reach the seam's
      // validation (invalid_classification), not be silently coerced.
      classification: data.classification as IssueInput['classification'],
      quarterId: data.quarterId ?? null,
    }
    return addIssue(db, getCookie(SESSION_COOKIE), input)
  })

export const updateIssueFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    d as { issueId?: number; title?: string; classification?: string; quarterId?: number | null },
  )
  .handler(async ({ data }) => {
    const db = await getDb()
    const input: Partial<IssueInput> = {
      title: data.title,
      classification:
        data.classification === 'short_term'
          ? 'short_term'
          : data.classification === 'long_term'
            ? 'long_term'
            : undefined,
      quarterId: data.quarterId,
    }
    return updateIssue(db, getCookie(SESSION_COOKIE), data.issueId ?? 0, input)
  })

export const resolveIssueFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { issueId?: number; outcome?: string; note?: string })
  .handler(async ({ data }) => {
    const db = await getDb()
    // Strict passthrough: garbage outcomes must reach the seam's validation
    // (note_required/invalid path), not be silently coerced to 'solved'.
    return resolveIssue(db, getCookie(SESSION_COOKIE), data.issueId ?? 0, {
      outcome: data.outcome as 'solved' | 'dropped',
      note: data.note ?? '',
    })
  })
// ================= Ticket 20: provenance + quarter-end carry =================

export const issueFromRockFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { rockId?: number })
  .handler(async ({ data }) => {
    const db = await getDb()
    return issueFromRock(db, getCookie(SESSION_COOKIE), data.rockId ?? 0)
  })

export const issueFromScorecardEntryFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { entryId?: number })
  .handler(async ({ data }) => {
    const db = await getDb()
    return issueFromScorecardEntry(db, getCookie(SESSION_COOKIE), data.entryId ?? 0)
  })

export const issueFromTodoFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { todoId?: number })
  .handler(async ({ data }) => {
    const db = await getDb()
    return issueFromTodo(db, getCookie(SESSION_COOKIE), data.todoId ?? 0)
  })

export const listUnresolvedForCarryFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => d as { fromQuarterId?: number })
  .handler(async ({ data }) => {
    const db = await getDb()
    return listUnresolvedForCarry(db, getCookie(SESSION_COOKIE), data?.fromQuarterId ?? 0)
  })

export const carryLongTermIssueFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { issueId?: number; toQuarterId?: number })
  .handler(async ({ data }) => {
    const db = await getDb()
    return carryLongTermIssue(db, getCookie(SESSION_COOKIE), data.issueId ?? 0, data.toQuarterId ?? 0)
  })

export const carryUnresolvedLongTermIssuesFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { fromQuarterId?: number; toQuarterId?: number })
  .handler(async ({ data }) => {
    const db = await getDb()
    return carryUnresolvedLongTermIssues(
      db,
      getCookie(SESSION_COOKIE),
      data.fromQuarterId ?? 0,
      data.toQuarterId ?? 0,
    )
  })
