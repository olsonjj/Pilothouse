import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { getCurrentUserFn, signOutFn } from '../functions/auth'
import { listQuartersFn, getCurrentPeriodFn } from '../functions/quarters'
import { listPeopleFn } from '../functions/people'
import {
  listRocksFn,
  createRockFn,
  updateRockFn,
  setStatusFn,
  listStatusesFn,
  scoreRockFn,
  completionRatesFn,
  carryOverFn,
} from '../functions/rocks'
import type { RockWithOwner, RockList, QuarterCompletion } from '../server/rocks'
import type { RockStatusValue } from '../server/rocks'
import { weekStart } from '../server/week'

export const Route = createFileRoute('/goals')({
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
    const statusHistory =
      currentQuarterId == null
        ? null
        : await listStatusesFn({ data: { quarterId: currentQuarterId } })
    return {
      me: me.ok ? me.user : null,
      quarters: quarterList.ok ? quarterList.value : [],
      people: peopleList.ok ? peopleList.value : [],
      currentQuarterId,
      /** Today's ISO date — the client uses it for the current-week column. */
      today: period.ok ? period.value.today : null,
      rocks,
      statusHistory: statusHistory && statusHistory.ok ? statusHistory.value : [],
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
      return 'Members can only create and edit their own personal goals.'
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
      return 'That quarter has ended — goals are read-only history.'
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
  const [statusHistory, setStatusHistory] = useState(data.statusHistory)
  const [completion, setCompletion] = useState<QuarterCompletion | null>(null)

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
    const history = await listStatusesFn({ data: { quarterId: qid } })
    if (history.ok) setStatusHistory(history.value)
  }

  // Completion rates load for whatever quarter is selected (meaningful when
  // the quarter has ended; the response carries the `ended` flag).
  useEffect(() => {
    if (quarterId == null) {
      setCompletion(null)
      return
    }
    let cancelled = false
    completionRatesFn({ data: { quarterId } }).then((result) => {
      if (!cancelled) setCompletion(result.ok ? result.value : null)
    })
    return () => {
      cancelled = true
    }
  }, [quarterId, rocks])

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
      setWarning('That makes more than 7 goals — the norm is 3–7. Consider deferring one.')
    } else {
      setWarning(null)
    }
    setEditing(null)
    await refresh(data.currentQuarterId)
  }

  function canEdit(rock: RockWithOwner): boolean {
    return isAdmin || (myPersonId != null && rock.ownerPersonId === myPersonId)
  }

  /** The selected quarter is writable only if it hasn't ended (strict < today). */
  function quarterWritable(quarterId: number | null): boolean {
    if (quarterId == null) return false
    const q = data.quarters.find((x) => x.id === quarterId)
    if (!q) return false
    return q.endDate >= (data.today ?? '')
  }

  async function handleSetStatus(
    rockId: number,
    status: RockStatusValue,
    actual?: string,
    comment?: string,
  ) {
    if (quarterId == null) return
    setBusy(true)
    setFormError(null)
    const week = weekStart(data.today ?? new Date().toISOString().slice(0, 10))
    const result = await setStatusFn({
      data: {
        rockId,
        week,
        status,
        actual: status === 'measuring' ? actual : null,
        comment: comment ?? null,
      },
    })
    setBusy(false)
    if (!result.ok) {
      setFormError(statusErrorText(result.error))
      return
    }
    await refresh(quarterId)
  }

  async function handleScore(rockId: number, completed: boolean) {
    setBusy(true)
    setFormError(null)
    const result = await scoreRockFn({ data: { rockId, completed } })
    setBusy(false)
    if (!result.ok) {
      setFormError(errorText(result.error))
      return
    }
    await refresh(quarterId)
  }

  async function handleCarry(rockId: number) {
    if (quarterId == null) return
    // Target = the quarter AFTER the one being viewed ("carry over to next
    // quarter"); the quarters list is label-ordered so this is deterministic.
    const idx = data.quarters.findIndex((q) => q.id === quarterId)
    const next = idx >= 0 && idx + 1 < data.quarters.length ? data.quarters[idx + 1] : null
    if (!next) {
      setFormError('No later quarter exists to carry into — seed it first.')
      return
    }
    setBusy(true)
    setFormError(null)
    const result = await carryOverFn({ data: { rockId, targetQuarterId: next.id } })
    setBusy(false)
    if (!result.ok) {
      setFormError(errorText(result.error))
      return
    }
    if ('warning' in result && result.warning === 'over_rock_cap') {
      setWarning(`Carried over into ${next.label} — that quarter now has more than 7 goals for that owner.`)
    } else {
      setWarning(`Goal carried over into ${next.label} — the original is untouched history.`)
    }
  }

  const writable = quarterWritable(quarterId)
  const historyByRock = new Map(statusHistory.map((h) => [h.rockId, h]))

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
    const history = historyByRock.get(rock.id)
    const latest = history?.statuses[history.statuses.length - 1] ?? null
    const flagged = latest?.twoConsecutiveOffTrack ?? false
    return (
      <li
        className={
          'flex items-start justify-between rounded border bg-white px-3 py-2 text-sm ' +
          (flagged ? 'border-2 border-red-500 ring-2 ring-red-200' : 'border-slate-200')
        }
      >
        <div>
          <span className="font-medium">{rock.statement}</span>
          {rock.carriedOverFromRockId != null && (
            <span
              className="ml-2 rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-700"
              title={`carried over from rock #${rock.carriedOverFromRockId}`}
            >
              ↩ carried over
            </span>
          )}
          {rock.completed != null && (
            <span
              className={
                'ml-2 rounded px-1.5 py-0.5 text-xs font-medium ' +
                (rock.completed === 1
                  ? 'bg-green-100 text-green-700'
                  : 'bg-slate-200 text-slate-600')
              }
            >
              {rock.completed === 1 ? '✓ complete' : '✗ incomplete'}
            </span>
          )}
          {flagged && (
            <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">
              off-track 2 weeks in a row
            </span>
          )}
          {rock.detail && <span className="block text-xs text-slate-500">{rock.detail}</span>}
          {measuring && (
            <span className="mt-1 block text-xs text-slate-500">
              target: {rock.target} ({rock.direction === 'gte' ? 'higher is better' : 'lower is better'})
            </span>
          )}
          {latest && (
            <span className="mt-1 block text-xs">
              this week:{' '}
              <span
                className={
                  latest.status === 'on_track'
                    ? 'text-green-700'
                    : latest.status === 'off_track'
                      ? 'text-red-700'
                      : 'text-blue-700'
                }
              >
                {latest.status === 'on_track'
                  ? '✓ on track'
                  : latest.status === 'off_track'
                    ? '✗ off track'
                    : `📊 measuring: ${latest.actual ?? '—'}`}
              </span>
              {latest.comment && <span className="text-slate-500"> — {latest.comment}</span>}
            </span>
          )}
          {history && history.statuses.length > 0 && <StatusDots history={history} />}
        </div>
        <div className="ml-4 flex shrink-0 items-center gap-2 text-xs text-slate-500">
          {rock.ownerName && <span>{rock.ownerName}</span>}
          {canEdit(rock) && writable && (
            <StatusControls
              rock={rock}
              measuring={measuring}
              busy={busy}
              onSet={handleSetStatus}
            />
          )}
          {canEdit(rock) && writable && (
            <button
              onClick={() => openEdit(rock)}
              className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-100"
            >
              Edit
            </button>
          )}
          {isAdmin && !writable && (
            <span className="flex items-center gap-1">
              <button
                disabled={busy}
                onClick={() => handleScore(rock.id, true)}
                className={
                  'rounded border px-2 py-0.5 hover:bg-green-50 disabled:opacity-40 ' +
                  (rock.completed === 1
                    ? 'border-green-500 bg-green-100 font-medium'
                    : 'border-slate-300')
                }
              >
                ✓
              </button>
              <button
                disabled={busy}
                onClick={() => handleScore(rock.id, false)}
                className={
                  'rounded border px-2 py-0.5 hover:bg-slate-100 disabled:opacity-40 ' +
                  (rock.completed === 0
                    ? 'border-slate-500 bg-slate-200 font-medium'
                    : 'border-slate-300')
                }
              >
                ✗
              </button>
              {rock.completed !== 1 && (
                <button
                  disabled={busy}
                  onClick={() => handleCarry(rock.id)}
                  title="Copy into a future quarter as a new rock (original untouched)"
                  className="rounded border border-purple-400 px-2 py-0.5 text-purple-700 hover:bg-purple-50 disabled:opacity-40"
                >
                  ↩ carry
                </button>
              )}
            </span>
          )}
        </div>
      </li>
    )
  }

  /** Week-by-week colored dots (oldest → newest) with a title tooltip. */
  function StatusDots({ history }: { history: { statuses: Array<{ week: string; status: string; actual: number | null; comment: string | null }> } }) {
    return (
      <span className="mt-1 flex gap-1" title="weekly status history">
        {history.statuses.map((s) => (
          <span
            key={s.week}
            title={`${s.week}: ${s.status}${s.actual != null ? ` (${s.actual})` : ''}${s.comment ? ` — ${s.comment}` : ''}`}
            className={
              'inline-block h-2.5 w-2.5 rounded-full ' +
              (s.status === 'on_track'
                ? 'bg-green-500'
                : s.status === 'off_track'
                  ? 'bg-red-500'
                  : 'bg-blue-500')
            }
          />
        ))}
      </span>
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
        <h1 className="text-xl font-semibold">Goals</h1>
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

      {completion && completion.ended && completion.people.length > 0 && (
        <div className="mt-3 rounded border border-slate-200 bg-white p-3 text-sm shadow-sm">
          <span className="font-medium">Quarter completion</span>
          <span className="ml-2 text-slate-500">
            team {completion.team.completed}/{completion.team.total} = {completion.team.rate ?? '—'}%
            <span className="text-slate-400"> (EOS norm ~80%)</span>
          </span>
          <ul className="mt-2 space-y-1">
            {completion.people.map((p) => (
              <li key={p.personId ?? 'company'} className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-slate-600">{p.personName ?? 'Company'}</span>
                <span className="h-2 flex-1 rounded bg-slate-100">
                  <span
                    className={
                      'block h-2 rounded ' + ((p.rate ?? 0) >= 80 ? 'bg-green-500' : 'bg-amber-400')
                    }
                    style={{ width: `${Math.min(100, p.rate ?? 0)}%` }}
                  />
                </span>
                <span className="w-24 shrink-0 text-right text-slate-500">
                  {p.completed}/{p.total} = {p.rate ?? '—'}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

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
              <h2 className="font-medium text-slate-700">Company goals</h2>
              {isAdmin && !editing && writable && (
                <button
                  onClick={() => openCreate('')}
                  className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
                >
                  Add company goal
                </button>
              )}
            </div>
            {rocks.company.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400">No company goals yet.</p>
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
              <h2 className="font-medium text-slate-700">Personal goals</h2>
              {!editing && writable && (
                <button
                  onClick={() => openCreate(String(myPersonId ?? ''))}
                  disabled={!isAdmin && myPersonId == null}
                  className="rounded border border-blue-600 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 disabled:opacity-40"
                >
                  {isAdmin ? 'Add personal goal' : 'Add my goal'}
                </button>
              )}
            </div>
            {rocks.personal.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400">No personal goals yet.</p>
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
/**
 * Per-rock weekly status controls (this week, computed from today): traffic
 * lights + actual input for measuring rocks + optional one-line comment.
 * Rendered only for users who can write the rock, in a writable quarter.
 */
function StatusControls(props: {
  rock: RockWithOwner
  measuring: boolean
  busy: boolean
  onSet: (rockId: number, status: RockStatusValue, actual?: string, comment?: string) => void
}) {
  const [showDetail, setShowDetail] = useState(false)
  const [actual, setActual] = useState('')
  const [comment, setComment] = useState('')

  function set(status: RockStatusValue) {
    if (status === 'measuring' && props.measuring) {
      setShowDetail(true)
      return
    }
    props.onSet(props.rock.id, status, actual, comment)
    setShowDetail(false)
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <span className="flex gap-1">
        <button
          disabled={props.busy}
          onClick={() => set('on_track')}
          className="rounded border border-green-600 px-1.5 py-0.5 text-green-700 hover:bg-green-50 disabled:opacity-40"
          title="On track"
        >
          ✓
        </button>
        <button
          disabled={props.busy}
          onClick={() => set('off_track')}
          className="rounded border border-red-600 px-1.5 py-0.5 text-red-700 hover:bg-red-50 disabled:opacity-40"
          title="Off track"
        >
          ✗
        </button>
        {props.measuring && (
          <button
            disabled={props.busy}
            onClick={() => set('measuring')}
            className="rounded border border-blue-600 px-1.5 py-0.5 text-blue-700 hover:bg-blue-50 disabled:opacity-40"
            title="Measuring (with actual)"
          >
            📊
          </button>
        )}
      </span>
      {showDetail && (
        <span className="flex items-center gap-1">
          <input
            autoFocus
            type="number"
            step="any"
            placeholder="actual"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            className="w-20 rounded border border-slate-300 px-1.5 py-0.5"
          />
          <input
            placeholder="note (optional)"
            maxLength={200}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="w-28 rounded border border-slate-300 px-1.5 py-0.5"
          />
          <button
            disabled={props.busy}
            onClick={() => {
              props.onSet(props.rock.id, 'measuring', actual, comment)
              setShowDetail(false)
            }}
            className="rounded bg-blue-600 px-1.5 py-0.5 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Save
          </button>
        </span>
      )}
    </span>
  )
}

function statusErrorText(error: string): string {
  switch (error) {
    case 'forbidden':
      return 'You can only set statuses on your own rocks.'
    case 'invalid_status':
      return 'Pick on track, off track, or measuring.'
    case 'invalid_week':
      return 'That week is not a valid date.'
    case 'measuring_requires_target':
      return 'Measuring needs a rock target — edit the rock to set one.'
    case 'invalid_actual':
      return 'Enter a finite number for the actual.'
    case 'actual_not_allowed':
      return 'Only measuring rocks carry a weekly actual.'
    case 'comment_too_long':
      return 'Comments are one line, max 200 characters.'
    case 'quarter_read_only':
      return 'That quarter has ended — statuses are read-only history.'
    default:
      return 'Something went wrong.'
  }
}
