import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { getCurrentUserFn, signOutFn } from '../functions/auth'
import { listQuartersFn, getCurrentPeriodFn } from '../functions/quarters'
import { listPeopleFn } from '../functions/people'
import { listRocksFn, createRockFn, updateRockFn } from '../functions/rocks'
import type { RockWithOwner, RockList } from '../server/rocks'

export const Route = createFileRoute('/rocks')({
  loader: async () => {
    const [me, quarterList, period, peopleList] = await Promise.all([
      getCurrentUserFn(),
      listQuartersFn(),
      getCurrentPeriodFn(),
      listPeopleFn(),
    ])
    /** Default selector: the current quarter (falls back to first seeded). */
    const fallbackQuarterId =
      quarterList.ok && quarterList.value.length > 0 ? quarterList.value[0].id : null
    const currentQuarterId = period.ok
      ? (period.value.quarter?.id ?? fallbackQuarterId)
      : fallbackQuarterId
    const rocks =
      currentQuarterId == null ? null : await listRocksFn({ data: { quarterId: currentQuarterId } })
    return {
      me: me.ok ? me.user : null,
      quarters: quarterList.ok ? quarterList.value : [],
      people: peopleList.ok ? peopleList.value : [],
      currentQuarterId,
      rocks,
    }
  },
  component: RocksPage,
})

type RockFormState = {
  id: number | null
  statement: string
  detail: string
  ownerPersonId: string
  target: string
  direction: '' | 'gte' | 'lte'
}

const EMPTY_ROCK_FORM: RockFormState = {
  id: null,
  statement: '',
  detail: '',
  ownerPersonId: '',
  target: '',
  direction: '',
}

function errorText(error: string): string {
  switch (error) {
    case 'forbidden':
      return 'Members can only create and edit their own personal rocks.'
    case 'statement_required':
      return 'A rock statement is required.'
    case 'target_direction_mismatch':
      return 'A target needs a direction (and vice versa) — or leave both empty.'
    case 'invalid_target':
      return 'Target must be a finite number.'
    case 'invalid_direction':
      return 'Direction must be "higher is better" or "lower is better".'
    case 'quarter_not_found':
      return 'That quarter does not exist.'
    case 'quarter_read_only':
      return 'That quarter has ended — rocks are read-only history.'
    case 'owner_not_found':
      return 'That person no longer exists — refresh.'
    case 'rock_not_found':
      return 'That rock no longer exists — refresh.'
    default:
      return 'Something went wrong.'
  }
}

function RocksPage() {
  const navigate = useNavigate()
  const data = Route.useLoaderData()
  const isAdmin = data.me?.role === 'admin'
  const myPersonId = data.me?.personId ?? null

  const [quarterId, setQuarterId] = useState<number | null>(data.currentQuarterId)
  const [rocks, setRocks] = useState<RockList | null>(
    data.rocks?.ok ? (data.rocks.value as RockList) : null,
  )
  const [warning, setWarning] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [editing, setEditing] = useState<RockFormState | null>(null)
  const [busy, setBusy] = useState(false)

  function openCreate(ownerPersonId: string) {
    setFormError(null)
    setWarning(null)
    setEditing({ ...EMPTY_ROCK_FORM, ownerPersonId })
  }

  function openEdit(rock: RockWithOwner) {
    setFormError(null)
    setWarning(null)
    setEditing({
      id: rock.id,
      statement: rock.statement,
      detail: rock.detail ?? '',
      ownerPersonId: rock.ownerPersonId == null ? '' : String(rock.ownerPersonId),
      target: rock.target == null ? '' : String(rock.target),
      direction: (rock.direction ?? '') as RockFormState['direction'],
    })
  }

  async function refresh(qid: number | null) {
    if (qid == null) return
    const result = await listRocksFn({ data: { quarterId: qid } })
    if (result.ok) {
      setRocks(result.value)
      setWarning(null)
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editing || data.currentQuarterId == null) return
    setBusy(true)
    setFormError(null)
    const target = editing.target.trim() === '' ? null : Number(editing.target)
    const direction = editing.direction === '' ? null : editing.direction
    const result = editing.id
      ? await updateRockFn({
          data: {
            rockId: editing.id,
            statement: editing.statement,
            detail: editing.detail,
            target,
            direction,
          },
        })
      : await createRockFn({
          data: {
            statement: editing.statement,
            detail: editing.detail,
            ownerPersonId: editing.ownerPersonId === '' ? null : Number(editing.ownerPersonId),
            quarterId: data.currentQuarterId ?? 0,
            target,
            direction,
          },
        })
    setBusy(false)
    if (!result.ok) {
      setFormError(errorText(result.error))
      return
    }
    if ('warning' in result && result.warning === 'over_rock_cap') {
      setWarning('That makes more than 7 rocks — the EOS norm is 3–7. Consider deferring one.')
    } else {
      setWarning(null)
    }
    setEditing(null)
    await refresh(data.currentQuarterId)
  }

  function canEdit(rock: RockWithOwner): boolean {
    return isAdmin || (myPersonId != null && rock.ownerPersonId === myPersonId)
  }

  async function handleSignOut() {
    await signOutFn()
    await navigate({ to: '/signin' })
  }

  function selectQuarter(quarterId: number) {
    setQuarterId(quarterId)
    void refresh(quarterId)
  }

  const peopleOptions = data.people.map((p) => (
    <option key={p.id} value={p.id}>
      {p.fullName}
    </option>
  ))

  function RockRow({ rock }: { rock: RockWithOwner }) {
    const measuring = rock.target != null
    return (
      <li className="flex items-start justify-between rounded border border-slate-200 bg-white px-3 py-2 text-sm">
        <div>
          <span className="font-medium">{rock.statement}</span>
          {rock.detail && <span className="block text-xs text-slate-500">{rock.detail}</span>}
          {measuring && (
            <span className="mt-1 block text-xs text-slate-500">
              target: {rock.target} ({rock.direction === 'gte' ? 'higher is better' : 'lower is better'})
            </span>
          )}
        </div>
        <div className="ml-4 flex shrink-0 items-center gap-2 text-xs text-slate-500">
          {rock.ownerName && <span>{rock.ownerName}</span>}
          {canEdit(rock) && (
            <button
              onClick={() => openEdit(rock)}
              className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-100"
            >
              Edit
            </button>
          )}
        </div>
      </li>
    )
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
        <h1 className="text-xl font-semibold">Rocks</h1>
        <select
          value={quarterId ?? ''}
          onChange={(e) => selectQuarter(Number(e.target.value))}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm"
        >
          {data.quarters.map((q) => (
            <option key={q.id} value={q.id}>
              {q.label}
            </option>
          ))}
        </select>
      </div>

      {warning && (
        <p className="mt-3 rounded border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
          {warning}
        </p>
      )}
      {formError && <p className="mt-3 text-sm text-red-600">{formError}</p>}

      {editing && (
        <form
          onSubmit={handleSave}
          className="mt-4 space-y-3 rounded border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 className="font-medium">{editing.id ? 'Edit rock' : 'New rock'}</h2>
          <label className="block text-sm">
            <span className="text-slate-700">
              Statement <span className="text-slate-400">(verb + what + done-by)</span>
            </span>
            <input
              required
              value={editing.statement}
              onChange={(e) => setEditing({ ...editing, statement: e.target.value })}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-700">Detail (optional)</span>
            <textarea
              value={editing.detail}
              onChange={(e) => setEditing({ ...editing, detail: e.target.value })}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              rows={2}
            />
          </label>
          {!editing.id && (
            <label className="block text-sm">
              <span className="text-slate-700">Owner</span>
              <select
                value={editing.ownerPersonId}
                onChange={(e) => setEditing({ ...editing, ownerPersonId: e.target.value })}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                disabled={!isAdmin}
              >
                {isAdmin && <option value="">Company rock (no owner)</option>}
                {!isAdmin && <option value={String(myPersonId)}>Me</option>}
                {isAdmin && peopleOptions}
              </select>
            </label>
          )}
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm">
              <span className="text-slate-700">Target (optional)</span>
              <input
                type="number"
                step="any"
                value={editing.target}
                onChange={(e) => setEditing({ ...editing, target: e.target.value })}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-700">Direction</span>
              <select
                value={editing.direction}
                onChange={(e) =>
                  setEditing({ ...editing, direction: e.target.value as RockFormState['direction'] })
                }
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              >
                <option value="">—</option>
                <option value="gte">Higher is better</option>
                <option value="lte">Lower is better</option>
              </select>
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
              onClick={() => setEditing(null)}
              className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {rocks && (
        <>
          <section className="mt-6">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-slate-700">Company rocks</h2>
              {isAdmin && !editing && (
                <button
                  onClick={() => openCreate('')}
                  className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
                >
                  Add company rock
                </button>
              )}
            </div>
            {rocks.company.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400">No company rocks yet.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {rocks.company.map((r) => (
                  <RockRow key={r.id} rock={r} />
                ))}
              </ul>
            )}
          </section>

          <section className="mt-8">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-slate-700">Personal rocks</h2>
              {!editing && (
                <button
                  onClick={() => openCreate(String(myPersonId ?? ''))}
                  disabled={!isAdmin && myPersonId == null}
                  className="rounded border border-blue-600 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 disabled:opacity-40"
                >
                  {isAdmin ? 'Add personal rock' : 'Add my rock'}
                </button>
              )}
            </div>
            {rocks.personal.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400">No personal rocks yet.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {rocks.personal.map((r) => (
                  <RockRow key={r.id} rock={r} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  )
}