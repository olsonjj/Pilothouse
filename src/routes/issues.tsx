import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { getCurrentUserFn, signOutFn } from '../functions/auth'
import { listQuartersFn } from '../functions/quarters'
import {
  listUnresolvedForCarryFn,
  carryLongTermIssueFn,
  carryUnresolvedLongTermIssuesFn,
} from '../functions/issues'
import {
  listIssuesFn,
  addIssueFn,
  updateIssueFn,
  resolveIssueFn,
} from '../functions/issues'
import type { IssueView } from '../server/issues'

export const Route = createFileRoute('/issues')({
  loader: async () => {
    const [me, quarters] = await Promise.all([getCurrentUserFn(), listQuartersFn()])
    return {
      me: me.ok ? me.user : null,
      quarters: quarters.ok ? quarters.value : [],
    }
  },
  component: IssuesPage,
})

function errorText(error: string): string {
  switch (error) {
    case 'unauthenticated':
      return 'Sign in first.'
    case 'title_required':
      return 'The issue needs a one-line title.'
    case 'classification_required':
      return 'Choose long-term or short-term.'
    case 'quarter_required':
      return 'No current quarter is seeded — long-term issues need one.'
    case 'quarter_not_allowed':
      return 'Short-term issues do not belong to a quarter.'
    case 'quarter_not_found':
      return 'That quarter does not exist.'
    case 'note_required':
      return 'A resolution note (or drop reason) is required.'
    case 'not_found':
      return 'That issue no longer exists — refresh.'
    case 'already_resolved':
      return 'That issue is already resolved.'
    case 'not_red':
      return 'That data cell is not red — only misses become issues.'
    case 'todo_not_missed':
      return 'That to-do is completed — not a miss.'
    case 'quarter_not_ended':
      return 'That quarter has not ended yet — carry-or-drop happens after it ends.'
    case 'quarter_read_only':
      return 'You cannot carry issues into a past quarter.'
    case 'forbidden':
      return 'Only admins can carry or bulk-carry issues.'
    default:
      return 'Something went wrong.'
  }
}

function ageLabel(weeks: number): string {
  return weeks <= 0 ? 'this week' : weeks === 1 ? '1 wk' : `${weeks} wks`
}

function IssuesPage() {
  const navigate = useNavigate()
  const data = Route.useLoaderData()

  const isAdmin = data.me?.role === 'admin'
  const [tab, setTab] = useState<'long_term' | 'short_term'>('short_term')
  const [open, setOpen] = useState<IssueView[]>([])
  const [resolved, setResolved] = useState<IssueView[]>([])
  const [showResolved, setShowResolved] = useState(false)
  const [title, setTitle] = useState('')
  const [quarterId, setQuarterId] = useState<string>('current')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    const [openResult, resolvedResult] = await Promise.all([
      listIssuesFn({ data: { classification: tab, includeResolved: false } }),
      listIssuesFn({ data: { classification: tab, includeResolved: true } }),
    ])
    // includeResolved ⊇ open list; derive the resolved section by difference.
    if (openResult.ok) setOpen(openResult.value)
    if (resolvedResult.ok) {
      const openIds = new Set(openResult.ok ? openResult.value.map((i) => i.id) : [])
      setResolved(resolvedResult.value.filter((i) => !openIds.has(i.id)))
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true)
    setError(null)
    const result = await action()
    setBusy(false)
    if (!result.ok) {
      setError(errorText(result.error ?? ''))
      return
    }
    await refresh()
  }

  async function handleSignOut() {
    await signOutFn()
    await navigate({ to: '/signin' })
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const effectiveQuarter =
      tab === 'long_term' ? (quarterId === 'current' ? null : Number(quarterId)) : null
    await run(async () => {
      const result = await addIssueFn({
        data: { title, classification: tab, quarterId: effectiveQuarter },
      })
      if (result.ok) setTitle('')
      return result
    })
  }

  function originLabel(origin: string): string | null {
    switch (origin) {
      case 'from_rock':
        return 'from goal'
      case 'from_scorecard':
        return 'from data'
      case 'from_todo':
        return 'from to-do'
      case 'from_meeting':
        return 'from meeting'
      default:
        return null
    }
  }

  const IssueRow = function IssueRow(props: { issue: IssueView }) {
    const issue = props.issue
    const resolvedRow = issue.status !== 'open'
    return (
      <li
        className={
          'card flex items-start justify-between gap-3 px-4 py-3 text-sm transition-shadow ' +
          (resolvedRow ? 'text-ink-muted' : '')
        }
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={'font-medium text-ink' + (resolvedRow ? ' line-through' : '')}>
              {issue.title}
            </span>
            {originLabel(issue.origin) && (
              <span className="badge badge-neutral">{originLabel(issue.origin)}</span>
            )}
          </div>
          <p className="tnum mt-0.5 text-xs text-ink-faint">
            {ageLabel(issue.ageWeeks)}
            {issue.addedByName ? ` · added by ${issue.addedByName}` : ''}
          </p>
          {issue.resolution && (
            <p className="mt-1 text-xs text-ink-muted">
              {issue.resolution.outcome === 'solved' ? 'Solved' : 'Dropped'}:{' '}
              {issue.resolution.note}
              {issue.resolution.resolvedByName ? ` — ${issue.resolution.resolvedByName}` : ''}
            </p>
          )}
        </div>
        {!resolvedRow && (
          <span className="flex shrink-0 gap-1">
            <button
              disabled={busy}
              onClick={() => {
                const note = window.prompt('Resolution note — what was decided? (required)')
                if (note && note.trim()) {
                  run(() => resolveIssueFn({ data: { issueId: issue.id, outcome: 'solved', note } }))
                } else if (note !== null) {
                  setError('A solved issue needs a resolution note.')
                }
              }}
              className="btn-secondary text-ok-ink hover:text-ok-ink"
            >
              Solved
            </button>
            <button
              disabled={busy}
              onClick={() => {
                const note = window.prompt('Why is this no longer an issue? (required)')
                if (note && note.trim()) {
                  run(() => resolveIssueFn({ data: { issueId: issue.id, outcome: 'dropped', note } }))
                } else if (note !== null) {
                  setError('A dropped issue needs a reason.')
                }
              }}
              className="btn-ghost"
            >
              Drop
            </button>
            <button
              disabled={busy}
              onClick={() => {
                const nextTab = tab === 'long_term' ? 'short_term' : 'long_term'
                run(async () => {
                  const result = await updateIssueFn({
                    data: { issueId: issue.id, classification: nextTab },
                  })
                  if (result.ok) setTab(nextTab)
                  return result
                })
              }}
              className="btn-ghost"
            >
              {tab === 'long_term' ? '→ Short' : '→ Long'}
            </button>
          </span>
        )}
      </li>
    )
  }

  return (
    <main className="mx-auto max-w-5xl p-8">
      <header className="flex items-center justify-between">
        <Link to="/" className="btn-ghost">
          ← Home
        </Link>
        <button onClick={handleSignOut} className="btn-ghost">
          Sign out
        </button>
      </header>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label-sm">Triage log</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Issues</h1>
        </div>
        <span className="badge badge-neutral">
          {open.length} open · {resolved.length} resolved
        </span>
      </div>

      {error && (
        <p className="mt-4 rounded border border-crit-border bg-crit-surface px-3 py-2 text-sm text-crit-ink">
          {error}
        </p>
      )}

      <div className="segmented mt-4">
        <button
          onClick={() => setTab('short_term')}
          className={tab === 'short_term' ? 'active' : ''}
        >
          Short-term
        </button>
        <button
          onClick={() => setTab('long_term')}
          className={tab === 'long_term' ? 'active' : ''}
        >
          Long-term
        </button>
      </div>

      <form onSubmit={handleAdd} className="card mt-4 flex flex-wrap items-end gap-2 p-4">
        <label className="min-w-0 flex-1 text-sm">
          <span className="label-sm">New issue</span>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Phrase it as a solution — 'Fix X'"
            className="input mt-1 w-full"
          />
        </label>
        {tab === 'long_term' && (
          <label className="text-sm">
            <span className="label-sm">Quarter</span>
            <select
              value={quarterId}
              onChange={(e) => setQuarterId(e.target.value)}
              className="input mt-1 block"
            >
              <option value="current">Current quarter</option>
              {data.quarters.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" disabled={busy} className="btn-primary">
          Add issue
        </button>
      </form>

      <section className="mt-6">
        <h2 className="label-sm">
          {tab === 'long_term' ? 'Long-term (quarter)' : 'Short-term (week)'} — open
        </h2>
        {open.length === 0 ? (
          <p className="card mt-2 px-4 py-6 text-center text-sm text-ink-faint">
            No open issues.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {open.map((issue) => (
              <IssueRow key={issue.id} issue={issue} />
            ))}
          </ul>
        )}
      </section>

      {isAdmin && <CarryPanel quarters={data.quarters} />}

      <section className="card mt-8">
        <button
          onClick={() => setShowResolved(!showResolved)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="flex items-center gap-2">
            <span className="label-sm">Resolved &amp; archived</span>
            <span className="badge badge-neutral">{resolved.length} kept forever</span>
          </span>
          <span className="text-xs text-ink-muted">{showResolved ? 'Hide log ▴' : 'Show log ▾'}</span>
        </button>
        {showResolved && (
          <ul className="space-y-2 border-t border-line p-3">
            {resolved.length === 0 ? (
              <li className="px-1 py-2 text-sm text-ink-faint">Nothing resolved yet.</li>
            ) : (
              resolved.map((issue) => <IssueRow key={issue.id} issue={issue} />)
            )}
          </ul>
        )}
      </section>
    </main>
  )
}
type QuarterOption = { id: number; label: string; startDate: string; endDate: string }

/**
 * Quarter-end carry-or-drop prompt (admin only): pick an ENDED quarter, see
 * its unresolved long-term issues, carry them (single or bulk) into a
 * not-yet-ended quarter, or drop with a reason. The lists re-fetch on every
 * action.
 */
function CarryPanel(props: { quarters: QuarterOption[] }) {
  const [fromQuarterId, setFromQuarterId] = useState<string>('')
  const [toQuarterId, setToQuarterId] = useState<string>('')
  const [issues, setIssues] = useState<Array<{ id: number; title: string }> | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const toOptions = props.quarters.filter(
    (q) => q.endDate >= new Date().toISOString().slice(0, 10),
  )

  async function review() {
    setError(null)
    setMessage(null)
    if (!fromQuarterId) return
    const result = await listUnresolvedForCarryFn({ data: { fromQuarterId: Number(fromQuarterId) } })
    if (result.ok) setIssues(result.value.map((i) => ({ id: i.id, title: i.title })))
    else setError(errorText(result.error))
  }

  async function act(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true)
    setError(null)
    const result = await action()
    setBusy(false)
    if (!result.ok) {
      setError(errorText(result.error ?? ''))
      return
    }
    await review()
  }

  return (
    <section className="card-raised mt-8 border-warn-border bg-warn-surface/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-warn-ink">Quarter-end carry-or-drop</h2>
        <span className="badge badge-ink">Admin</span>
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        Pick an ended quarter to review its unresolved long-term issues — carry them forward or
        drop them. Short-term issues are never offered.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <select
          value={fromQuarterId}
          onChange={(e) => {
            setFromQuarterId(e.target.value)
            setIssues(null)
            setMessage(null)
          }}
          className="input"
        >
          <option value="">Ended quarter…</option>
          {props.quarters.map((q) => (
            <option key={q.id} value={q.id}>
              {q.label} (ends {q.endDate})
            </option>
          ))}
        </select>
        <button onClick={review} disabled={busy || !fromQuarterId} className="btn-secondary">
          Review
        </button>
        <span aria-hidden className="text-ink-faint">
          →
        </span>
        <select
          value={toQuarterId}
          onChange={(e) => setToQuarterId(e.target.value)}
          className="input"
        >
          <option value="">Carry into…</option>
          {toOptions.map((q) => (
            <option key={q.id} value={q.id}>
              {q.label}
            </option>
          ))}
        </select>
        <button
          disabled={busy || !fromQuarterId || !toQuarterId || !issues || issues.length === 0}
          onClick={() =>
            act(async () => {
              const result = await carryUnresolvedLongTermIssuesFn({
                data: { fromQuarterId: Number(fromQuarterId), toQuarterId: Number(toQuarterId) },
              })
              if (result.ok) setMessage(`Carried ${result.value.carried} issue(s).`)
              return result.ok ? { ok: true } : result
            })
          }
          className="btn-primary"
        >
          Carry all
        </button>
      </div>
      {error && (
        <p className="mt-3 rounded border border-crit-border bg-crit-surface px-3 py-2 text-sm text-crit-ink">
          {error}
        </p>
      )}
      {message && (
        <p className="mt-3 rounded border border-ok-border bg-ok-surface px-3 py-2 text-sm text-ok-ink">
          {message}
        </p>
      )}
      {issues && (
        <ul className="mt-3 space-y-2">
          {issues.length === 0 && (
            <li className="rounded border border-line bg-white px-3 py-2 text-sm text-ink-muted">
              Nothing unresolved in that quarter. 🎉
            </li>
          )}
          {issues.map((issue) => (
            <li
              key={issue.id}
              className="flex items-center justify-between gap-2 rounded border border-line bg-white px-3 py-2 text-sm"
            >
              <span className="text-ink">{issue.title}</span>
              <span className="flex shrink-0 gap-1">
                <button
                  disabled={busy || !toQuarterId}
                  onClick={() =>
                    act(() =>
                      carryLongTermIssueFn({
                        data: { issueId: issue.id, toQuarterId: Number(toQuarterId) },
                      }),
                    )
                  }
                  className="btn-secondary"
                >
                  Carry
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    const note = window.prompt('Why is this being dropped? (required)')
                    if (note && note.trim()) {
                      act(() =>
                        resolveIssueFn({
                          data: { issueId: issue.id, outcome: 'dropped', note },
                        }),
                      )
                    } else if (note !== null) {
                      setError('A dropped issue needs a reason.')
                    }
                  }}
                  className="btn-ghost"
                >
                  Drop
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}