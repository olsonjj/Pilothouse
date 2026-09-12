import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { getCurrentUserFn, signOutFn } from '../functions/auth'
import { getCurrentPeriodFn, listQuartersFn } from '../functions/quarters'
import { getAnalyzerFn, setScoreFn } from '../functions/peopleAnalyzer'
import type { AnalyzerRow, Score } from '../server/peopleAnalyzer'

export const Route = createFileRoute('/employee-assessment')({
  loader: async () => {
    const [me, quarterList, period] = await Promise.all([
      getCurrentUserFn(),
      listQuartersFn(),
      getCurrentPeriodFn(),
    ])
    return {
      me: me.ok ? me.user : null,
      quarters: quarterList.ok ? quarterList.value : [],
      /** Current quarter id for the default selector (null if unseeded). */
      currentQuarterId: period.ok ? (period.value.quarter?.id ?? null) : null,
    }
  },
  component: AnalyzerPage,
})

const SCORE_OPTIONS: Array<{ value: Score; label: string; title: string }> = [
  { value: '+', label: '✓', title: 'Exemplifies' },
  { value: '-', label: '−', title: 'Mostly / needs work' },
  { value: '--', label: '−−', title: 'Does not exemplify' },
]

function errorText(error: string): string {
  if (error === 'forbidden') return 'Employee Assessment scores are admins only.'
  if (error === 'unauthenticated') return 'Sign in first.'
  return 'Something went wrong.'
}

/** Verdict → status badge pill mapping (ok / warn / crit / standby). */
function verdictBadge(verdict: string): string {
  switch (verdict) {
    case 'Exemplifies the values':
      return 'badge badge-ok'
    case 'Right person? Not yet':
      return 'badge badge-warn'
    case 'Not exemplifying the values':
      return 'badge badge-crit'
    case 'Complete Right Fit first':
      return 'badge badge-neutral'
    default:
      return 'badge badge-neutral'
  }
}

/** Selected score control tone: ✓ green, − amber, −− red. */
function scoreTone(value: Score): string {
  switch (value) {
    case '+':
      return 'border-ok-border bg-ok-surface text-ok-ink'
    case '-':
      return 'border-warn-border bg-warn-surface text-warn-ink'
    case '--':
      return 'border-crit-border bg-crit-surface text-crit-ink'
  }
}

function AnalyzerPage() {
  const navigate = useNavigate()
  const data = Route.useLoaderData()
  const isAdmin = data.me?.role === 'admin'

  const [quarterId, setQuarterId] = useState<number | null>(
    data.currentQuarterId ?? (data.quarters.length > 0 ? data.quarters[0].id : null),
  )
  const [view, setView] = useState<Awaited<ReturnType<typeof getAnalyzerFn>> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isAdmin || quarterId == null) return
    let cancelled = false
    getAnalyzerFn({ data: { quarterId } }).then((result) => {
      if (!cancelled) setView(result)
    })
    return () => {
      cancelled = true
    }
  }, [isAdmin, quarterId])

  async function handleSignOut() {
    await signOutFn()
    await navigate({ to: '/signin' })
  }

  async function setScore(personId: number, coreValueId: number, score: Score) {
    if (!isAdmin || quarterId == null) return
    setBusy(true)
    setError(null)
    const result = await setScoreFn({
      data: { personId, quarterId, coreValueId, score },
    })
    setBusy(false)
    if (!result.ok) {
      setError(errorText(result.error))
      return
    }
    const refreshed = await getAnalyzerFn({ data: { quarterId } })
    setView(refreshed)
  }

  if (!isAdmin) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <Link to="/people" className="btn-ghost">
          ← People
        </Link>
        <div className="card mt-8 p-6 text-center text-sm text-ink-secondary">
          The Employee Assessment is admins only — scores are sensitive assessments.
        </div>
      </main>
    )
  }

  const analyzer = view?.ok ? view.value : null

  return (
    <main className="mx-auto max-w-6xl p-8">
      <header className="flex items-center justify-between">
        <Link to="/people" className="btn-ghost">
          ← People
        </Link>
        <button onClick={handleSignOut} className="btn-ghost">
          Sign out
        </button>
      </header>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-sm">People scorecard</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Employee Assessment</h1>
        </div>
        <label className="block">
          <span className="label-sm">Quarter</span>
          <select
            value={quarterId ?? ''}
            onChange={(e) => setQuarterId(e.target.value ? Number(e.target.value) : null)}
            className="input mt-1 block"
          >
            {data.quarters.map((q) => (
              <option key={q.id} value={q.id}>
                {q.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-2 text-sm text-ink-secondary">
        Score each person against each core value: ✓ exemplifies, − needs work, −− does not
        exemplify. Right Fit comes from their active seats.
      </p>

      {error && (
        <p className="mt-4 rounded border border-crit-border bg-crit-surface px-3 py-2 text-sm text-crit-ink">
          {error}
        </p>
      )}

      {!analyzer && <p className="mt-6 text-sm text-ink-faint">Loading…</p>}

      {analyzer && analyzer.values.length === 0 && (
        <div className="card mt-6 p-6 text-center text-sm text-ink-faint">
          No core values yet — add them on the Company page first.
        </div>
      )}

      {analyzer && analyzer.values.length > 0 && (
        <table className="table-precision mt-6">
          <thead>
            <tr>
              <th>Person</th>
              {analyzer.values.map((v) => (
                <th key={v.id} className="text-center">
                  <span className="whitespace-normal">{v.name}</span>
                  {!v.active && (
                    <span className="badge badge-neutral ml-1 !h-4 !px-1.5 !text-[10px]">
                      inactive
                    </span>
                  )}
                </th>
              ))}
              <th>Right Fit</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {analyzer.rows.map((row) => (
              <AnalyzerRowGrid
                key={row.personId}
                row={row}
                values={analyzer.values}
                busy={busy}
                onScore={setScore}
              />
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}

function AnalyzerRowGrid(props: {
  row: AnalyzerRow
  values: Array<{ id: number; name: string; active: boolean }>
  busy: boolean
  onScore: (personId: number, coreValueId: number, score: Score) => void
}) {
  const { row } = props
  const ratedSeats =
    !row.gwc.incomplete && row.gwc.seats.length > 0
      ? row.gwc.seats
          .map(
            (s) =>
              `${s.seatName}: ${s.get ? '✓' : '✗'}/${s.want ? '✓' : '✗'}/${s.capacity ? '✓' : '✗'}`,
          )
          .join(' · ')
      : null
  return (
    <tr>
      <td className="font-medium">{row.personName}</td>
      {props.values.map((v) => {
        const current = row.scores[v.id]
        return (
          <td key={v.id} className="text-center">
            <span className="inline-flex gap-1">
              {SCORE_OPTIONS.map((opt) => (
                <button
                  key={v.id + optKey(opt.value)}
                  disabled={props.busy}
                  title={opt.title}
                  onClick={() => props.onScore(row.personId, v.id, opt.value)}
                  className={
                    'rounded border px-1.5 py-0.5 text-xs font-semibold transition-colors disabled:opacity-50 ' +
                    (current === opt.value
                      ? scoreTone(opt.value)
                      : 'border-line text-ink-muted hover:bg-panel') +
                    (!v.active && current === undefined ? ' opacity-40' : '')
                  }
                >
                  {opt.label}
                </button>
              ))}
            </span>
          </td>
        )
      })}
      <td className="tnum font-mono text-xs text-ink-secondary">{ratedSeats ?? '—'}</td>
      <td>
        <span className={verdictBadge(row.verdict)}>{row.verdict}</span>
      </td>
    </tr>
  )
}

function optKey(value: string): string {
  return value === '--' ? 'mm' : value
}