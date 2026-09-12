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
      return 'A goal statement is required.'
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
      return 'That goal no longer exists — refresh.'
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

  const goalCount = rocks ? rocks.company.length + rocks.personal.length : 0

  function RockRow({ rock }: { rock: RockWithOwner }) {
    const measuring = rock.target != null
    const history = historyByRock.get(rock.id)
    const latest = history?.statuses[history.statuses.length - 1] ?? null
    const flagged = latest?.twoConsecutiveOffTrack ?? false
    const accent = flagged
      ? 'border-l-[3px] border-l-[var(--color-crit-dot)]'
      : rock.ownerPersonId == null
        ? 'border-l-[3px] border-l-[var(--color-navy)]'
        : 'border-l-[3px] border-l-[var(--color-beacon)]'
    return (
      <li className={`card border-l-[3px] p-4 ${accent}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="label-sm">{rock.ownerPersonId == null ? 'Company goal' : 'Personal goal'}</span>
          {latest && (
            <span
              className={
                'badge ' +
                (latest.status === 'on_track'
                  ? 'badge-ok'
                  : latest.status === 'off_track'
                    ? 'badge-crit'
                    : 'badge-neutral')
              }
            >
              {latest.status === 'on_track'
                ? 'On track'
                : latest.status === 'off_track'
                  ? 'Off track'
                  : 'Measuring'}
            </span>
          )}
          {rock.carriedOverFromRockId != null && (
            <span
              className="badge badge-neutral"
              title={`carried over from goal #${rock.carriedOverFromRockId}`}
            >
              ↩ carried over
            </span>
          )}
          {rock.completed != null && (
            <span className={'badge ' + (rock.completed === 1 ? 'badge-ok' : 'badge-neutral')}>
              {rock.completed === 1 ? '✓ complete' : '✗ incomplete'}
            </span>
          )}
          {flagged && <span className="badge badge-crit">off-track 2 weeks in a row</span>}
        </div>
        <p className="mt-2 text-[15px] font-semibold leading-snug text-[var(--color-ink)]">
          {rock.statement}
        </p>
        {rock.detail && <p className="mt-1 text-sm text-[var(--color-ink-secondary)]">{rock.detail}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-ink-secondary)]">
          {rock.ownerName && (
            <span>
              Owner: <span className="font-medium text-[var(--color-ink)]">{rock.ownerName}</span>
            </span>
          )}
          {measuring && (
            <span className="tnum font-mono text-xs">
              Target {rock.direction === 'gte' ? '≥' : '≤'} {rock.target}
            </span>
          )}
          {latest && (
            <span className="flex items-center gap-1">
              This week:{' '}
              <span
                className={
                  'tnum font-mono text-xs font-medium ' +
                  (latest.status === 'on_track'
                    ? 'text-[var(--color-ok-ink)]'
                    : latest.status === 'off_track'
                      ? 'text-[var(--color-crit-ink)]'
                      : 'text-[var(--color-beacon)]')
                }
              >
                {latest.status === 'on_track'
                  ? '✓ on track'
                  : latest.status === 'off_track'
                    ? '✗ off track'
                    : `📊 measuring: ${latest.actual ?? '—'}`}
              </span>
              {latest.comment && <span className="text-[var(--color-ink-muted)]">— {latest.comment}</span>}
            </span>
          )}
        </div>
        {history && history.statuses.length > 0 && <StatusDots history={history} />}
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-line-soft)] pt-3 text-xs">
          {canEdit(rock) && writable && (
            <StatusControls
              rock={rock}
              measuring={measuring}
              busy={busy}
              onSet={handleSetStatus}
            />
          )}
          {canEdit(rock) && writable && (
            <button onClick={() => openEdit(rock)} className="btn-secondary">
              Edit
            </button>
          )}
          {isAdmin && !writable && (
            <span className="flex items-center gap-1">
              <button
                disabled={busy}
                onClick={() => handleScore(rock.id, true)}
                title="Mark complete"
                className={
                  'btn-secondary h-7 px-2 ' +
                  (rock.completed === 1
                    ? 'border-[var(--color-ok-border)] bg-[var(--color-ok-surface)] font-semibold text-[var(--color-ok-ink)]'
                    : '')
                }
              >
                ✓
              </button>
              <button
                disabled={busy}
                onClick={() => handleScore(rock.id, false)}
                title="Mark incomplete"
                className={
                  'btn-secondary h-7 px-2 ' +
                  (rock.completed === 0
                    ? 'border-[var(--color-standby-border)] bg-[var(--color-panel)] font-semibold'
                    : '')
                }
              >
                ✗
              </button>
              {rock.completed !== 1 && (
                <button
                  disabled={busy}
                  onClick={() => handleCarry(rock.id)}
                  title="Copy into a future quarter as a new goal (original untouched)"
                  className="btn-secondary h-7 px-2 disabled:opacity-40"
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

  /** Week-by-week status tiles (oldest → newest) with a tooltip carrying the full entry. */
  function StatusDots({ history }: { history: { statuses: Array<{ week: string; status: string; actual: number | null; comment: string | null }> } }) {
    return (
      <span className="mt-3 flex flex-wrap gap-1" title="weekly status history">
        {history.statuses.map((s, i) => (
          <span
            key={s.week}
            title={`${s.week}: ${s.status}${s.actual != null ? ` (${s.actual})` : ''}${s.comment ? ` — ${s.comment}` : ''}`}
            className={
              'tnum inline-flex h-7 min-w-8 items-center justify-center rounded border font-mono text-xs ' +
              (s.status === 'on_track'
                ? 'border-[var(--color-ok-border)] bg-[var(--color-ok-surface)] text-[var(--color-ok-ink)]'
                : s.status === 'off_track'
                  ? 'border-[var(--color-crit-border)] bg-[var(--color-crit-surface)] text-[var(--color-crit-ink)]'
                  : 'border-[var(--color-line)] bg-[var(--color-canvas)] text-[var(--color-beacon)]') +
              (i === history.statuses.length - 1 ? ' ring-1 ring-[var(--color-ruler)]' : '')
            }
          >
            {s.status === 'on_track' ? '✓' : s.status === 'off_track' ? '✗' : '📊'}
          </span>
        ))}
      </span>
    )
  }

  return (
    <main className="mx-auto max-w-4xl p-8">
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
          <p className="label-sm">Quarterly priorities</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Goals</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {quarterId != null && (
            <span className={'badge ' + (writable ? 'badge-ok' : 'badge-neutral')}>
              {writable ? 'Active quarter' : 'Quarter ended'}
            </span>
          )}
          {rocks && (
            <span className="badge badge-neutral">
              {goalCount} {goalCount === 1 ? 'goal' : 'goals'}
            </span>
          )}
          <select
            value={quarterId ?? ''}
            onChange={(e) => selectQuarter(Number(e.target.value))}
            className="input"
            aria-label="Quarter"
          >
            {data.quarters.map((q) => (
              <option key={q.id} value={q.id}>
                {q.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {rocks && writable && (
        <p className="mt-3 text-sm text-[var(--color-ink-secondary)]">
          Quarterly priorities: <span className="font-medium">{goalCount}</span> active goals of the
          recommended 3–7 target envelope
          <span className="tnum ml-2 rounded border border-[var(--color-line)] bg-[var(--color-canvas)] px-1.5 py-0.5 font-mono text-xs">
            {goalCount} / 7
          </span>
        </p>
      )}

      {warning && (
        <div className="mt-3 flex items-start gap-2 rounded border border-[var(--color-warn-border)] bg-[var(--color-warn-surface)] px-4 py-2 text-sm text-[var(--color-warn-ink)]">
          {warning}
        </div>
      )}
      {formError && (
        <div className="mt-3 rounded border border-[var(--color-crit-border)] bg-[var(--color-crit-surface)] px-4 py-2 text-sm text-[var(--color-crit-ink)]">
          {formError}
        </div>
      )}

      {completion && completion.ended && completion.people.length > 0 && (
        <div className="card mt-4 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="label-sm">Quarter completion</span>
            <span className="tnum text-sm text-[var(--color-ink-secondary)]">
              team {completion.team.completed}/{completion.team.total} ={' '}
              <span className="font-mono font-medium">{completion.team.rate ?? '—'}%</span>
              <span className="ml-1 text-[var(--color-ink-faint)]">(~80% norm)</span>
            </span>
          </div>
          <ul className="mt-3 space-y-2">
            {completion.people.map((p) => (
              <li key={p.personId ?? 'company'} className="flex items-center gap-3">
                <span className="w-28 shrink-0 truncate text-sm text-[var(--color-ink-secondary)]">
                  {p.personName ?? 'Company'}
                </span>
                <span className="h-1.5 flex-1 rounded-full bg-[var(--color-panel)]">
                  <span
                    className={
                      'block h-1.5 rounded-full ' +
                      ((p.rate ?? 0) >= 80
                        ? 'bg-[var(--color-ok-dot)]'
                        : 'bg-[var(--color-warn-dot)]')
                    }
                    style={{ width: `${Math.min(100, p.rate ?? 0)}%` }}
                  />
                </span>
                <span className="tnum w-28 shrink-0 text-right font-mono text-xs text-[var(--color-ink-secondary)]">
                  {p.completed}/{p.total} = {p.rate ?? '—'}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing && (
        <form onSubmit={handleSave} className="card-raised mt-4 space-y-4 p-5">
          <h2 className="text-base font-semibold">{editing.id ? 'Edit goal' : 'New goal'}</h2>
          <label className="block text-sm">
            <span className="label-sm">
              Statement <span className="normal-case text-[var(--color-ink-faint)]">(verb + what + done-by)</span>
            </span>
            <input
              required
              value={editing.statement}
              onChange={(e) => setEditing({ ...editing, statement: e.target.value })}
              className="input mt-1 w-full"
            />
          </label>
          <label className="block text-sm">
            <span className="label-sm">Detail (optional)</span>
            <textarea
              value={editing.detail}
              onChange={(e) => setEditing({ ...editing, detail: e.target.value })}
              className="input mt-1 w-full"
              rows={2}
            />
          </label>
          {!editing.id && (
            <label className="block text-sm">
              <span className="label-sm">Owner</span>
              <select
                value={editing.ownerPersonId}
                onChange={(e) => setEditing({ ...editing, ownerPersonId: e.target.value })}
                className="input mt-1 w-full"
                disabled={!isAdmin}
              >
                {isAdmin && <option value="">Company goal (no owner)</option>}
                {!isAdmin && <option value={String(myPersonId)}>Me</option>}
                {isAdmin && peopleOptions}
              </select>
            </label>
          )}
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm">
              <span className="label-sm">Target (optional)</span>
              <input
                type="number"
                step="any"
                value={editing.target}
                onChange={(e) => setEditing({ ...editing, target: e.target.value })}
                className="input mt-1 w-full"
              />
            </label>
            <label className="block text-sm">
              <span className="label-sm">Direction</span>
              <select
                value={editing.direction}
                onChange={(e) =>
                  setEditing({ ...editing, direction: e.target.value as RockFormState['direction'] })
                }
                className="input mt-1 w-full"
              >
                <option value="">—</option>
                <option value="gte">Higher is better</option>
                <option value="lte">Lower is better</option>
              </select>
            </label>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="btn-primary">
              Save
            </button>
            <button type="button" onClick={() => setEditing(null)} className="btn-secondary">
              Cancel
            </button>
          </div>
        </form>
      )}

      {rocks && (
        <>
          <section className="mt-8">
            <div className="flex items-center justify-between">
              <h2 className="label-sm">Company goals</h2>
              {isAdmin && !editing && writable && (
                <button onClick={() => openCreate('')} className="btn-primary">
                  Add company goal
                </button>
              )}
            </div>
            {rocks.company.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--color-ink-faint)]">No company goals yet.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {rocks.company.map((r) => (
                  <RockRow key={r.id} rock={r} />
                ))}
              </ul>
            )}
          </section>

          <section className="mt-8">
            <div className="flex items-center justify-between">
              <h2 className="label-sm">Personal goals</h2>
              {!editing && writable && (
                <button
                  onClick={() => openCreate(String(myPersonId ?? ''))}
                  disabled={!isAdmin && myPersonId == null}
                  className="btn-secondary disabled:opacity-40"
                >
                  {isAdmin ? 'Add personal goal' : 'Add my goal'}
                </button>
              )}
            </div>
            {rocks.personal.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--color-ink-faint)]">No personal goals yet.</p>
            ) : (
              <ul className="mt-3 space-y-3">
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
          className="btn-secondary h-7 border-[var(--color-ok-border)] px-2 text-[var(--color-ok-ink)] hover:border-[var(--color-ok-dot)] hover:bg-[var(--color-ok-surface)] disabled:opacity-40"
          title="On track"
        >
          ✓
        </button>
        <button
          disabled={props.busy}
          onClick={() => set('off_track')}
          className="btn-secondary h-7 border-[var(--color-crit-border)] px-2 text-[var(--color-crit-ink)] hover:border-[var(--color-crit-dot)] hover:bg-[var(--color-crit-surface)] disabled:opacity-40"
          title="Off track"
        >
          ✗
        </button>
        {props.measuring && (
          <button
            disabled={props.busy}
            onClick={() => set('measuring')}
            className="btn-secondary h-7 border-[var(--color-line)] px-2 text-[var(--color-beacon)] hover:border-[var(--color-beacon)] disabled:opacity-40"
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
            className="input h-7 w-20 px-1.5 text-xs"
          />
          <input
            placeholder="note (optional)"
            maxLength={200}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="input h-7 w-28 px-1.5 text-xs"
          />
          <button
            disabled={props.busy}
            onClick={() => {
              props.onSet(props.rock.id, 'measuring', actual, comment)
              setShowDetail(false)
            }}
            className="btn-primary h-7 px-2 text-xs"
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
      return 'You can only set statuses on your own goals.'
    case 'invalid_status':
      return 'Pick on track, off track, or measuring.'
    case 'invalid_week':
      return 'That week is not a valid date.'
    case 'measuring_requires_target':
      return 'Measuring needs a goal target — edit the rock to set one.'
    case 'invalid_actual':
      return 'Enter a finite number for the actual.'
    case 'actual_not_allowed':
      return 'Only measuring goals carry a weekly actual.'
    case 'comment_too_long':
      return 'Comments are one line, max 200 characters.'
    case 'quarter_read_only':
      return 'That quarter has ended — statuses are read-only history.'
    default:
      return 'Something went wrong.'
  }
}