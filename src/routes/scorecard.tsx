import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { getCurrentUserFn, signOutFn } from '../functions/auth'
import { listPeopleFn } from '../functions/people'
import {
  listMetricsFn,
  listAllMetricsFn,
  createMetricFn,
  updateMetricFn,
} from '../functions/metrics'
import type { MetricWithOwner } from '../server/metrics'

export const Route = createFileRoute('/scorecard')({
  loader: async () => {
    // listAllMetricsFn (with retired rows) is admin-only; members get the
    // active-only public list via the fallback.
    const [me, people, allMetrics] = await Promise.all([
      getCurrentUserFn(),
      listPeopleFn(),
      listAllMetricsFn(),
    ])
    const isAdmin = me.ok && me.user.role === 'admin'
    const list = allMetrics.ok
      ? allMetrics.value
      : ((await listMetricsFn()) as { ok: true; value: MetricWithOwner[] }).value
    return { me: me.ok ? me.user : null, isAdmin, people: people.ok ? people.value : [], list }
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
  const [form, setForm] = useState<MetricFormState | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    const result = isAdmin ? await listAllMetricsFn() : await listMetricsFn()
    if (result.ok) setMetrics(result.value)
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
        Weekly pulse metrics. Weekly entries and the grid arrive with the next release.
      </p>

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
            {isAdmin && <th className="px-4 py-2 font-medium">Status</th>}
            {isAdmin && <th className="px-4 py-2" />}
          </tr>
        </thead>
        <tbody>
          {metrics.length === 0 && (
            <tr>
              <td colSpan={isAdmin ? 5 : 3} className="px-4 py-6 text-center text-slate-400">
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