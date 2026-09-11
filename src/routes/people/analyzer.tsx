import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { getCurrentUserFn, signOutFn } from '../../functions/auth'
import { getCurrentPeriodFn, listQuartersFn } from '../../functions/quarters'
import { getAnalyzerFn, setScoreFn } from '../../functions/peopleAnalyzer'
import type { AnalyzerRow, Score } from '../../server/peopleAnalyzer'

export const Route = createFileRoute('/people/analyzer')({
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
        <Link to="/people" className="text-sm text-blue-600 hover:underline">
          ← People
        </Link>
        <p className="mt-8 rounded border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
          The Employee Assessment is admins only — scores are sensitive assessments.
        </p>
      </main>
    )
  }

  const analyzer = view?.ok ? view.value : null

  return (
    <main className="mx-auto max-w-5xl p-8">
      <header className="flex items-center justify-between">
        <Link to="/people" className="text-sm text-blue-600 hover:underline">
          ← People
        </Link>
        <button
          onClick={handleSignOut}
          className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
        >
          Sign out
        </button>
      </header>

      <div className="mt-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Employee Assessment</h1>
        <select
          value={quarterId ?? ''}
          onChange={(e) => setQuarterId(e.target.value ? Number(e.target.value) : null)}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm"
        >
          {data.quarters.map((q) => (
            <option key={q.id} value={q.id}>
              {q.label}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Score each person against each core value: ✓ exemplifies, − needs work, −− does not
        exemplify. GWC comes from their active seats.
      </p>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {!analyzer && <p className="mt-6 text-sm text-slate-500">Loading…</p>}

      {analyzer && analyzer.values.length === 0 && (
        <p className="mt-6 rounded border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          No core values yet — add them on the Company page first.
        </p>
      )}

      {analyzer && analyzer.values.length > 0 && (
        <table className="mt-4 w-full rounded border border-slate-200 bg-white text-sm shadow-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="px-3 py-2 font-medium">Person</th>
              {analyzer.values.map((v) => (
                <th key={v.id} className="px-3 py-2 text-center font-medium">
                  {v.name}
                  {!v.active && <span className="ml-1 text-xs text-slate-400">(inactive)</span>}
                </th>
              ))}
              <th className="px-3 py-2 font-medium">GWC</th>
              <th className="px-3 py-2 font-medium">Verdict</th>
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
  const gwcLabel = row.gwc.incomplete
    ? 'unrated'
    : row.gwc.seats.length === 0
      ? 'no seats'
      : row.gwc.seats
          .map(
            (s) =>
              `${s.seatName}: ${s.get ? '✓' : '✗'}/${s.want ? '✓' : '✗'}/${s.capacity ? '✓' : '✗'}`,
          )
          .join(' · ')
  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="px-3 py-2 font-medium">{row.personName}</td>
      {props.values.map((v) => {
        const current = row.scores[v.id]
        return (
          <td key={v.id} className="px-3 py-2">
            <span className="flex gap-1">
              {SCORE_OPTIONS.map((opt) => (
                <button
                  key={v.id + optKey(opt.value)}
                  disabled={props.busy}
                  title={opt.title}
                  onClick={() => props.onScore(row.personId, v.id, opt.value)}
                  className={
                    'rounded border px-1.5 py-0.5 text-xs ' +
                    (current === opt.value
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-300 text-slate-600 hover:bg-slate-100') +
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
      <td className="px-3 py-2 text-xs text-slate-600">{gwcLabel}</td>
      <td className="px-3 py-2 text-xs font-medium text-slate-700">{row.verdict}</td>
    </tr>
  )
}

function optKey(value: string): string {
  return value === '--' ? 'mm' : value
}