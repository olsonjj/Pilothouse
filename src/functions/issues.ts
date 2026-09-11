import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { getDb } from '../server/db'
import { SESSION_COOKIE } from '../server/auth'
import {
  addIssue,
  updateIssue,
  resolveIssue,
  listIssues,
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