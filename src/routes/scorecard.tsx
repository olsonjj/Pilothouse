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

export const Route = createFileRoute('/scorecard')({
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
    <main className="mx-auto max-w-3xl p-8">
      <header className="flex items-center justify-between">
        <Link to="/" className="text-sm text-blue-600 hover:underline">
          ← Home
        </Link>
        <button
          onClick={handleSignOut}
          className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
        >
          Sign out
        </button>
      </header>

      <div className="mt-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Scorecard — metrics</h1>
        {isAdmin && (
          <button
            onClick={openCreate}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
          >
            Add metric
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Weekly pulse metrics. The grid below covers the last 8 weeks.
      </p>

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

      {formError && <p className="mt-2 text-sm text-red-600">{formError}</p>}

      {form && isAdmin && (
        <form
          onSubmit={handleSave}
          className="mt-4 space-y-3 rounded border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 className="font-medium">{form.id ? 'Edit metric' : 'New metric'}</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-700">Name</span>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-700">Owner</span>
              <select
                value={form.ownerPersonId ?? ''}
                onChange={(e) =>
                  setForm({ ...form, ownerPersonId: e.target.value ? Number(e.target.value) : null })
                }
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
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
              <span className="text-slate-700">Weekly target</span>
              <input
                required
                type="number"
                step="any"
                value={form.target}
                onChange={(e) => setForm({ ...form, target: e.target.value })}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-700">Direction</span>
              <select
                value={form.direction}
                onChange={(e) =>
                  setForm({ ...form, direction: e.target.value as 'gte' | 'lte' })
                }
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              >
                <option value="gte">≥ target is good</option>
                <option value="lte">≤ target is good</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-700">Unit (optional, e.g. %, $)</span>
              <input
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="mt-1 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              <span className="text-slate-700">Active</span>
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={closeEditor}
              className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <table className="mt-6 w-full rounded border border-slate-200 bg-white text-sm shadow-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="px-4 py-2 font-medium">Metric</th>
            <th className="px-4 py-2 font-medium">Owner</th>
            <th className="px-4 py-2 font-medium">Weekly target</th>
            <th className="px-4 py-2 font-medium">Trend</th>
            {isAdmin && <th className="px-4 py-2 font-medium">Status</th>}
            {isAdmin && <th className="px-4 py-2" />}
          </tr>
        </thead>
        <tbody>
          {metrics.length === 0 && (
            <tr>
              <td colSpan={isAdmin ? 6 : 4} className="px-4 py-6 text-center text-slate-400">
                No metrics yet.
              </td>
            </tr>
          )}
          {metrics.map((m) => (
            <tr
              key={m.id}
              className={
                'border-b border-slate-100 last:border-0' +
                (m.active === 0 ? ' text-slate-400' : '')
              }
            >
              <td className="px-4 py-2 font-medium">
                {m.name}
                {m.active === 0 && <span className="ml-2 text-xs">(retired)</span>}
              </td>
              <td className="px-4 py-2 text-slate-600">{m.ownerName}</td>
              <td className="px-4 py-2 text-slate-600">{targetDisplay(m)}</td>
              <td className="px-4 py-2">
                <button
                  onClick={() => toggleTrend(m.id)}
                  className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
                >
                  {trendOpenFor === m.id ? 'Hide trend' : 'Trend'}
                </button>
              </td>
              {isAdmin && (
                <td className="px-4 py-2">
                  <button
                    onClick={() => toggleActive(m)}
                    disabled={busy}
                    className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-50"
                  >
                    {m.active === 1 ? 'Retire' : 'Reactivate'}
                  </button>
                </td>
              )}
              {isAdmin && (
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => openEdit(m)}
                    className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
                  >
                    Edit
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
function cellClass(pass: boolean | null): string {
  if (pass === true) return 'bg-green-100 text-green-800'
  if (pass === false) return 'bg-red-100 text-red-700'
  return 'text-slate-300'
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
  return (
    <div className="mt-6 overflow-x-auto rounded border border-slate-200 bg-white shadow-sm">
      <h2 className="border-b border-slate-200 px-4 py-3 font-medium">Weekly grid</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="sticky left-0 bg-white px-4 py-2 font-medium">Metric</th>
            {props.grid.weeks.map((w) => (
              <th key={w.monday} className="px-2 py-2 text-center text-xs font-medium">
                {w.label.replace('Week of ', '')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.grid.metrics.map((m) => {
            const canEdit = props.isAdmin || props.mePersonId === m.ownerPersonId
            return (
              <tr key={m.id} className="border-b border-slate-100 last:border-0">
                <td className="sticky left-0 bg-white px-4 py-2">
                  <div className="font-medium">{m.name}</div>
                  <div className="text-xs text-slate-500">
                    {(m.direction === 'gte' ? '≥ ' : '≤ ') + m.target}
                    {m.unit ? ` ${m.unit}` : ''} · {m.ownerName}
                  </div>
                </td>
                {m.cells.map((cell, i) => {
                  const monday = props.grid.weeks[i]!.monday
                  const isEditing =
                    editing?.metricId === m.id && editing.monday === monday
                  return (
                    <td
                      key={monday}
                      className={'px-2 py-2 text-center ' + cellClass(cell.pass)}
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
                          className="w-16 rounded border border-blue-400 px-1 py-0.5 text-center text-xs"
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
                            'w-full px-1 py-0.5 text-center text-xs ' +
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
    <div className="mt-4 rounded border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">
          Trend — {trend.metric.name}
          {trend.metric.unit ? ` (${trend.metric.unit})` : ''}
          {trend.metric.active === 0 && <span className="ml-2 text-xs text-slate-400">(retired)</span>}
        </h2>
        <button
          onClick={props.onClose}
          className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
        >
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
                    ? 'bg-slate-200'
                    : p.pass
                      ? 'bg-green-500'
                      : 'bg-red-500')
                }
                style={{ height: `${pct}%` }}
                title={p.actual == null ? `${p.label}: no entry` : `${p.label}: ${p.actual}`}
              />
              <span className="mt-1 text-[10px] text-slate-500">
                {p.label.replace('Week of ', '').replace(' ', '\u00a0')}
              </span>
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-slate-500">
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
    <div className="mt-4 rounded border border-slate-200 bg-white shadow-sm">
      <h2 className="border-b border-slate-200 px-4 py-3 font-medium">
        On-track % — trailing 12 weeks ({rollup.windowStart} … before {rollup.windowEnd})
      </h2>
      <div className="flex flex-wrap">
        <table className="w-full min-w-72 flex-1 text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="px-4 py-2 font-medium">Metric</th>
              <th className="px-4 py-2 font-medium">Owner</th>
              <th className="px-4 py-2 font-medium">On track</th>
              <th className="px-4 py-2 font-medium">%</th>
            </tr>
          </thead>
          <tbody>
            {rollup.metrics.map((m) => (
              <tr key={m.metricId} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2 font-medium">{m.metricName}</td>
                <td className="px-4 py-2 text-slate-600">{m.ownerName}</td>
                <td className="px-4 py-2 text-slate-600">
                  {m.counted === 0 ? '—' : `${m.done}/${m.counted}`}
                </td>
                <td className="px-4 py-2 font-medium">{rateDisplay(m.rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="w-full min-w-64 border-l border-slate-100 text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="px-4 py-2 font-medium">Owner rollup</th>
              <th className="px-4 py-2 font-medium">%</th>
            </tr>
          </thead>
          <tbody>
            {rollup.owners.length === 0 && (
              <tr>
                <td colSpan={2} className="px-4 py-6 text-center text-slate-400">
                  No window entries yet.
                </td>
              </tr>
            )}
            {rollup.owners.map((o) => (
              <tr key={o.ownerPersonId} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2">
                  {o.ownerName}{' '}
                  <span className="text-xs text-slate-500">
                    ({o.done}/{o.counted})
                  </span>
                </td>
                <td className="px-4 py-2 font-medium">{rateDisplay(o.rate)}</td>
              </tr>
            ))}
            <tr className="bg-slate-50 font-medium">
              <td className="px-4 py-2">
                Team{' '}
                <span className="text-xs text-slate-500">
                  ({rollup.team.done}/{rollup.team.counted})
                </span>
              </td>
              <td className="px-4 py-2">{rateDisplay(rollup.team.rate)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
