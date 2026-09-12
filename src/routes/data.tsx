import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { getCurrentUserFn, signOutFn } from '../functions/auth'
import { listPeopleFn } from '../functions/people'
import {
  listMetricsFn,
  listAllMetricsFn,
  createMetricFn,
  updateMetricFn,
  listGridFn,
  setEntryFn,
  metricTrendFn,
  onTrackRollupFn,
} from '../functions/metrics'
import type { MetricWithOwner, MetricGrid, MetricTrend, OnTrackRollup } from '../server/metrics'

export const Route = createFileRoute('/data')({
  loader: async () => {
    // listAllMetricsFn (with retired rows) is admin-only; members get the
    // active-only public list via the fallback.
    const [me, people, allMetrics, grid, rollup] = await Promise.all([
      getCurrentUserFn(),
      listPeopleFn(),
      listAllMetricsFn(),
      listGridFn(),
      onTrackRollupFn(),
    ])
    const isAdmin = me.ok && me.user.role === 'admin'
    const list = allMetrics.ok
      ? allMetrics.value
      : ((await listMetricsFn()) as { ok: true; value: MetricWithOwner[] }).value
    return {
      me: me.ok ? me.user : null,
      isAdmin,
      people: people.ok ? people.value : [],
      list,
      grid: grid.ok ? grid.value : null,
      rollup,
    }
  },
  component: ScorecardPage,
})

type MetricFormState = {
  id: number | null
  name: string
  ownerPersonId: number | null
  target: string
  direction: 'gte' | 'lte'
  unit: string
  active: boolean
}

const EMPTY_FORM: MetricFormState = {
  id: null,
  name: '',
  ownerPersonId: null,
  target: '',
  direction: 'gte',
  unit: '',
  active: true,
}

function errorText(error: string): string {
  switch (error) {
    case 'forbidden':
      return 'Only admins can do that.'
    case 'name_required':
      return 'Metric name is required.'
    case 'invalid_target':
      return 'Target must be a finite number.'
    case 'invalid_direction':
      return 'Direction must be "higher is better" or "lower is better".'
    case 'invalid_actual':
      return 'Enter a finite number for the weekly value.'
    case 'metric_inactive':
      return 'That metric is retired — reactivate it to enter numbers.'
    case 'not_found':
      return 'That item no longer exists — refresh.'
    default:
      return 'Something went wrong.'
  }
}

function targetDisplay(m: MetricWithOwner): string {
  const cmp = m.direction === 'gte' ? '≥' : '≤'
  return `${cmp} ${m.target}${m.unit ? ` ${m.unit}` : ''}`
}

function ScorecardPage() {
  const navigate = useNavigate()
  const data = Route.useLoaderData()
  const isAdmin = data.isAdmin

  const [metrics, setMetrics] = useState<MetricWithOwner[]>(data.list)
  const [grid, setGrid] = useState<MetricGrid | null>(data.grid)
  const [rollup, setRollup] = useState<OnTrackRollup | null>(data.rollup.ok ? data.rollup.value : null)
  const [trend, setTrend] = useState<MetricTrend | null>(null)
  const [trendOpenFor, setTrendOpenFor] = useState<number | null>(null)
  const [form, setForm] = useState<MetricFormState | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    const result = isAdmin ? await listAllMetricsFn() : await listMetricsFn()
    if (result.ok) setMetrics(result.value)
    const gridResult = await listGridFn()
    if (gridResult.ok) setGrid(gridResult.value)
    const rollupResult = await onTrackRollupFn()
    if (rollupResult.ok) setRollup(rollupResult.value)
    // Keep an open trend panel fresh across entry edits.
    if (trendOpenFor != null) {
      const trendResult = await metricTrendFn({ data: { metricId: trendOpenFor } })
      setTrend(trendResult.ok ? trendResult.value : null)
    }
  }

  async function toggleTrend(metricId: number) {
    if (trendOpenFor === metricId) {
      setTrendOpenFor(null)
      setTrend(null)
      return
    }
    setTrendOpenFor(metricId)
    setFormError(null)
    const result = await metricTrendFn({ data: { metricId } })
    if (!result.ok) {
      setFormError(errorText(result.error))
      setTrendOpenFor(null)
      return
    }
    setTrend(result.value)
  }

  async function handleEntrySave(metricId: number, monday: string, raw: string) {
    if (raw === '') return
    setBusy(true)
    setFormError(null)
    const result = await setEntryFn({ data: { metricId, week: monday, actual: raw } })
    setBusy(false)
    if (!result.ok) {
      setFormError(errorText(result.error))
      return
    }
    await refresh()
  }

  async function handleSignOut() {
    await signOutFn()
    await navigate({ to: '/signin' })
  }

  function openCreate() {
    setFormError(null)
    setForm({ ...EMPTY_FORM, ownerPersonId: data.people[0]?.id ?? null })
  }

  function openEdit(m: MetricWithOwner) {
    setFormError(null)
    setForm({
      id: m.id,
      name: m.name,
      ownerPersonId: m.ownerPersonId,
      target: String(m.target),
      direction: m.direction as 'gte' | 'lte',
      unit: m.unit ?? '',
      active: m.active === 1,
    })
  }

  function closeEditor() {
    setForm(null)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    setBusy(true)
    setFormError(null)
    const input = {
      name: form.name,
      ownerPersonId: form.ownerPersonId ?? 0,
      target: form.target === '' ? NaN : Number(form.target),
      direction: form.direction,
      unit: form.unit,
      active: form.active,
    }
    const result = form.id
      ? await updateMetricFn({ data: { id: form.id, ...input } })
      : await createMetricFn({ data: input })
    setBusy(false)
    if (!result.ok) {
      setFormError(errorText(result.error))
      return
    }
    closeEditor()
    await refresh()
  }

  async function toggleActive(m: MetricWithOwner) {
    setBusy(true)
    setFormError(null)
    const result = await updateMetricFn({
      data: {
        id: m.id,
        name: m.name,
        ownerPersonId: m.ownerPersonId,
        target: m.target,
        direction: m.direction,
        unit: m.unit,
        active: m.active !== 1,
      },
    })
    setBusy(false)
    if (!result.ok) {
      setFormError(errorText(result.error))
      return
    }
    await refresh()
  }

  return (
    <main className="mx-auto max-w-6xl p-8">
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
          <p className="label-sm">Company scorecard</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Data — metrics</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Weekly pulse metrics. The grid below covers the last 8 weeks.
          </p>
        </div>
        {isAdmin && (
          <button onClick={openCreate} className="btn-primary">
            + Add metric
          </button>
        )}
      </div>

      {formError && (
        <p className="mt-4 rounded border border-crit-border bg-crit-surface px-3 py-2 text-sm text-crit-ink">
          {formError}
        </p>
      )}

      {grid && grid.metrics.length > 0 && (
        <WeeklyGrid
          grid={grid}
          mePersonId={data.me?.personId ?? null}
          isAdmin={isAdmin}
          busy={busy}
          onSave={handleEntrySave}
        />
      )}

      {trendOpenFor != null && trend && trend.metric.id === trendOpenFor && (
        <TrendPanel trend={trend} onClose={() => { setTrendOpenFor(null); setTrend(null) }} />
      )}

      {rollup && <RollupTable rollup={rollup} />}

      {form && isAdmin && (
        <form onSubmit={handleSave} className="card mt-6 space-y-3 p-4">
          <h2 className="text-base font-semibold">{form.id ? 'Edit metric' : 'New metric'}</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="block text-sm">
              <span className="label-sm">Name</span>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="input mt-1 w-full"
              />
            </label>
            <label className="block text-sm">
              <span className="label-sm">Owner</span>
              <select
                value={form.ownerPersonId ?? ''}
                onChange={(e) =>
                  setForm({ ...form, ownerPersonId: e.target.value ? Number(e.target.value) : null })
                }
                className="input mt-1 w-full"
              >
                <option value="">Choose a person…</option>
                {data.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="label-sm">Weekly target</span>
              <input
                required
                type="number"
                step="any"
                value={form.target}
                onChange={(e) => setForm({ ...form, target: e.target.value })}
                className="input mt-1 w-full tnum"
              />
            </label>
            <label className="block text-sm">
              <span className="label-sm">Direction</span>
              <select
                value={form.direction}
                onChange={(e) =>
                  setForm({ ...form, direction: e.target.value as 'gte' | 'lte' })
                }
                className="input mt-1 w-full"
              >
                <option value="gte">≥ target is good</option>
                <option value="lte">≤ target is good</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="label-sm">Unit (optional, e.g. %, $)</span>
              <input
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                className="input mt-1 w-full"
              />
            </label>
            <label className="mt-1 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
                className="check-box"
              />
              <span className="text-ink-secondary">Active</span>
            </label>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="btn-primary disabled:opacity-50">
              Save
            </button>
            <button type="button" onClick={closeEditor} className="btn-secondary">
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="mt-6">
        <p className="label-sm">Metric definitions</p>
        <table className="table-precision mt-2 text-sm">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Owner</th>
              <th className="num">Weekly target</th>
              <th>Trend</th>
              {isAdmin && <th>Status</th>}
              {isAdmin && <th aria-label="actions" />}
            </tr>
          </thead>
          <tbody>
            {metrics.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 6 : 4} className="text-center text-ink-faint">
                  No metrics yet.
                </td>
              </tr>
            )}
            {metrics.map((m) => (
              <tr key={m.id} className={m.active === 0 ? 'text-ink-faint' : ''}>
                <td className="font-medium">
                  {m.name}
                  {m.active === 0 && <span className="badge badge-neutral ml-2">retired</span>}
                </td>
                <td className="text-ink-secondary">{m.ownerName}</td>
                <td className="num text-ink-secondary">{targetDisplay(m)}</td>
                <td>
                  <button
                    onClick={() => toggleTrend(m.id)}
                    className="btn-secondary h-7 px-2 text-xs"
                  >
                    {trendOpenFor === m.id ? 'Hide trend' : 'Trend'}
                  </button>
                </td>
                {isAdmin && (
                  <td>
                    <button
                      onClick={() => toggleActive(m)}
                      disabled={busy}
                      className="btn-secondary h-7 px-2 text-xs disabled:opacity-50"
                    >
                      {m.active === 1 ? 'Retire' : 'Reactivate'}
                    </button>
                  </td>
                )}
                {isAdmin && (
                  <td className="text-right">
                    <button onClick={() => openEdit(m)} className="btn-ghost h-7 px-2 text-xs">
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}
function cellClass(pass: boolean | null): string {
  if (pass === true) return 'bg-ok-surface text-ok-ink'
  if (pass === false) return 'bg-crit-surface text-crit-ink'
  return 'text-ink-faint'
}

/**
 * The weekly grid (ticket 14): metric rows × week columns, traffic lights
 * derived server-side. Editable inline by admins and the metric's owner
 * (server enforces — the UI only enables inputs).
 */
function WeeklyGrid(props: {
  grid: MetricGrid
  mePersonId: number | null
  isAdmin: boolean
  busy: boolean
  onSave: (metricId: number, monday: string, raw: string) => void
}) {
  const [editing, setEditing] = useState<{ metricId: number; monday: string; value: string } | null>(
    null,
  )
  const lastWeek = props.grid.weeks[props.grid.weeks.length - 1]?.monday
  return (
    <div className="card mt-6 overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-base font-semibold">Weekly grid</h2>
        <span className="label-sm">Last 8 operating weeks</span>
      </div>
      <div className="overflow-x-auto">
        <table className="table-precision border-0">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-canvas">Metric</th>
              {props.grid.weeks.map((w) => (
                <th
                  key={w.monday}
                  className={
                    'tnum text-center font-mono text-xs' +
                    (w.monday === lastWeek ? ' border-x border-line bg-panel' : '')
                  }
                >
                  {w.label.replace('Week of ', '')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.grid.metrics.map((m) => {
              const canEdit = props.isAdmin || props.mePersonId === m.ownerPersonId
              return (
                <tr key={m.id}>
                  <td className="sticky left-0 z-10 bg-white">
                    <div className="font-medium">{m.name}</div>
                    <div className="tnum mt-0.5 font-mono text-xs text-ink-muted">
                      {(m.direction === 'gte' ? '≥ ' : '≤ ') + m.target}
                      {m.unit ? ` ${m.unit}` : ''} · {m.ownerName}
                    </div>
                  </td>
                  {m.cells.map((cell, i) => {
                    const monday = props.grid.weeks[i]!.monday
                    const isEditing =
                      editing?.metricId === m.id && editing.monday === monday
                    const isCurrent = monday === lastWeek
                    return (
                      <td
                        key={monday}
                        className={
                          'px-2 py-2 text-center ' +
                          cellClass(cell.pass) +
                          (isCurrent ? ' border-x border-line bg-panel' : '')
                        }
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            disabled={props.busy}
                            defaultValue={editing!.value}
                            onBlur={(e) => {
                              setEditing(null)
                              props.onSave(m.id, monday, e.target.value)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                setEditing(null)
                                props.onSave(m.id, monday, e.currentTarget.value)
                              }
                              if (e.key === 'Escape') setEditing(null)
                            }}
                            className="tnum w-16 rounded border border-beacon bg-white px-1 py-0.5 text-center font-mono text-xs"
                          />
                        ) : (
                          <button
                            disabled={!canEdit || props.busy}
                            onClick={() =>
                              canEdit &&
                              setEditing({
                                metricId: m.id,
                                monday,
                                value: cell.actual == null ? '' : String(cell.actual),
                              })
                            }
                            className={
                              'tnum w-full px-1 py-0.5 text-center font-mono text-xs ' +
                              (canEdit ? 'cursor-pointer hover:underline' : 'cursor-default')
                            }
                            title={canEdit ? 'Click to enter / edit' : 'Read-only'}
                          >
                            {cell.actual == null ? '–' : cell.actual}
                          </button>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * Per-metric 8–12 week trend (ticket 15): hand-rolled flex bars — no chart
 * library. Bar height is proportional to `actual` within [min,max] of this
 * metric's window entries; green/red per server-derived pass; gray when the
 * week has no entry. Responsive: bars wrap via flex-wrap on narrow screens.
 */
function TrendPanel(props: { trend: MetricTrend; onClose: () => void }) {
  const { trend } = props
  const actuals = trend.points.filter((p) => p.actual != null).map((p) => p.actual!)
  const min = actuals.length > 0 ? Math.min(...actuals) : 0
  const max = actuals.length > 0 ? Math.max(...actuals) : 1
  const span = max - min || 1 // flat series → mid-height bars
  return (
    <div className="card mt-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">
          Trend — {trend.metric.name}
          {trend.metric.unit ? ` (${trend.metric.unit})` : ''}
          {trend.metric.active === 0 && <span className="badge badge-neutral ml-2">retired</span>}
        </h2>
        <button onClick={props.onClose} className="btn-secondary h-7 px-2 text-xs">
          Close
        </button>
      </div>
      <div className="mt-4 flex h-32 flex-wrap items-end gap-1">
        {trend.points.map((p) => {
          const pct = p.actual == null ? 0 : 20 + ((p.actual - min) / span) * 80
          return (
            <div key={p.week} className="flex w-10 flex-col items-center justify-end">
              <div
                className={
                  'w-full rounded-t ' +
                  (p.pass == null
                    ? 'bg-line'
                    : p.pass
                      ? 'bg-ok-dot'
                      : 'bg-crit-dot')
                }
                style={{ height: `${pct}%` }}
                title={p.actual == null ? `${p.label}: no entry` : `${p.label}: ${p.actual}`}
              />
              <span className="tnum mt-1 font-mono text-[10px] text-ink-muted">
                {p.label.replace('Week of ', '').replace(' ', '\u00a0')}
              </span>
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-ink-secondary">
        Bars colored by target pass/fail (server-derived); gray = no entry that week.
      </p>
    </div>
  )
}

function rateDisplay(rate: number | null): string {
  return rate == null ? '—' : `${rate.toFixed(1)}%`
}

/**
 * Trailing-quarter on-track % rollup (ticket 15): per metric, per owner, and
 * team. Weeks without entries are excluded from both sides (missing number
 * ≠ miss); null rate renders "—".
 */
function RollupTable(props: { rollup: OnTrackRollup }) {
  const { rollup } = props
  return (
    <div className="card mt-4 overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <p className="label-sm">On-track %</p>
        <h2 className="mt-0.5 text-base font-semibold">
          Trailing 12 weeks <span className="font-mono text-sm font-medium text-ink-secondary">({rollup.windowStart} … before {rollup.windowEnd})</span>
        </h2>
      </div>
      <div className="flex flex-wrap">
        <table className="table-precision min-w-72 flex-1 border-0">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Owner</th>
              <th className="num">On track</th>
              <th className="num">%</th>
            </tr>
          </thead>
          <tbody>
            {rollup.metrics.map((m) => (
              <tr key={m.metricId}>
                <td className="font-medium">{m.metricName}</td>
                <td className="text-ink-secondary">{m.ownerName}</td>
                <td className="num text-ink-secondary">
                  {m.counted === 0 ? '—' : `${m.done}/${m.counted}`}
                </td>
                <td className="num font-medium">{rateDisplay(m.rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="table-precision min-w-64 flex-1 border-0 border-l border-line">
          <thead>
            <tr>
              <th>Owner rollup</th>
              <th className="num">%</th>
            </tr>
          </thead>
          <tbody>
            {rollup.owners.length === 0 && (
              <tr>
                <td colSpan={2} className="text-center text-ink-faint">
                  No window entries yet.
                </td>
              </tr>
            )}
            {rollup.owners.map((o) => (
              <tr key={o.ownerPersonId}>
                <td>
                  {o.ownerName}{' '}
                  <span className="tnum font-mono text-xs text-ink-muted">
                    ({o.done}/{o.counted})
                  </span>
                </td>
                <td className="num font-medium">{rateDisplay(o.rate)}</td>
              </tr>
            ))}
            <tr className="bg-panel font-medium">
              <td>
                Team{' '}
                <span className="tnum font-mono text-xs text-ink-muted">
                  ({rollup.team.done}/{rollup.team.counted})
                </span>
              </td>
              <td className="num">{rateDisplay(rollup.team.rate)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}