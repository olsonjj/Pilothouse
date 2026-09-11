import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { getCurrentUserFn, signOutFn } from '../functions/auth'
import { listPeopleFn } from '../functions/people'
import {
  getOpenMeetingFn,
  startMeetingFn,
  advanceSegmentFn,
  deleteMeetingFn,
  setFacilitatorFn,
  listMeetingsFn,
  getPreloadedDataFn,
} from '../functions/meetings'
import type { MeetingWithSegments, SegmentView, MeetingSummary } from '../server/meetings'

export const Route = createFileRoute('/l10')({
  loader: async () => {
    const [me, people, open, history] = await Promise.all([
      getCurrentUserFn(),
      listPeopleFn(),
      getOpenMeetingFn(),
      listMeetingsFn(),
    ])
    return {
      me: me.ok ? me.user : null,
      people: people.ok ? people.value : [],
      open: open.ok ? open.value : null,
      history: history.ok ? history.value : [],
    }
  },
  component: L10Page,
})

function fmtClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Advisory countdown: planned minutes from segment entry; never locks anything. */
function SegmentTimer(props: { segment: SegmentView; now: number }) {
  const { segment } = props
  if (segment.done) {
    return <span className="text-xs text-slate-400">{fmtClock(segment.elapsedSeconds)} used</span>
  }
  if (!segment.active) {
    return <span className="text-xs text-slate-400">{segment.plannedMinutes} min</span>
  }
  const elapsed = Math.max(0, Math.floor((props.now - Date.parse(segment.enteredAt!)) / 1000))
  const planned = segment.plannedMinutes * 60
  const remaining = planned - elapsed
  return (
    <span className={'text-xs font-mono ' + (remaining < 0 ? 'text-red-600' : 'text-slate-600')}>
      {fmtClock(Math.max(0, remaining))} left {remaining < 0 ? '(over)' : ''}
    </span>
  )
}

function errorText(error: string): string {
  switch (error) {
    case 'unauthenticated':
      return 'Sign in first.'
    case 'open_meeting_exists':
      return 'A meeting is already open — join it instead.'
    case 'meeting_concluded':
      return 'That meeting has concluded and is frozen.'
    case 'meeting_not_found':
      return 'That meeting no longer exists — refresh.'
    case 'segment_not_active':
      return 'That segment is not the current one.'
    case 'segment_not_found':
      return 'That segment no longer exists.'
    case 'conclude_is_ticket_25':
      return 'Concluding the meeting happens in the Conclude step (coming in ticket 25).'
    case 'person_not_found':
      return 'That person no longer exists.'
    default:
      return 'Something went wrong.'
  }
}

function L10Page() {
  const navigate = useNavigate()
  const data = Route.useLoaderData()
  const [open, setOpen] = useState<MeetingWithSegments | null>(data.open)
  const [history, setHistory] = useState<MeetingSummary[]>(data.history)
  const [preloaded, setPreloaded] = useState<Awaited<ReturnType<typeof getPreloadedDataFn>> | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Advisory tick for countdowns (1s; purely presentational).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Pre-loaded segment data refreshes with the open meeting.
  useEffect(() => {
    let cancelled = false
    if (open) getPreloadedDataFn().then((r) => !cancelled && setPreloaded(r))
    return () => {
      cancelled = true
    }
  }, [open?.id, open?.segments])

  async function refreshHistory() {
    const result = await listMeetingsFn()
    if (result.ok) setHistory(result.value)
  }

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true)
    setError(null)
    const result = await action()
    setBusy(false)
    if (!result.ok && 'error' in result) {
      setError(errorText(result.error ?? ''))
      return false
    }
    return true
  }

  async function handleStart() {
    const ok = await run(async () => {
      const result = await startMeetingFn()
      if (result.ok) setOpen(result.value)
      return result
    })
    if (ok) await refreshHistory()
  }

  async function handleAdvance(segment: SegmentView) {
    if (!open) return
    await run(async () => {
      const result = await advanceSegmentFn({ data: { meetingId: open.id, segmentId: segment.id } })
      if (result.ok) setOpen(result.value)
      return result
    })
  }

  async function handleDelete() {
    if (!open) return
    const ok = await run(async () => {
      const result = await deleteMeetingFn({ data: { meetingId: open.id } })
      if (result.ok) setOpen(null)
      return result
    })
    if (ok) await refreshHistory()
  }

  async function handleFacilitator(personId: number | null) {
    if (!open) return
    await run(async () => {
      const result = await setFacilitatorFn({ data: { meetingId: open.id, personId } })
      if (result.ok) setOpen(result.value)
      return result
    })
  }

  async function handleSignOut() {
    await signOutFn()
    await navigate({ to: '/signin' })
  }

  const pre = preloaded?.ok ? preloaded.value : null

  return (
    <main className="mx-auto max-w-4xl p-8">
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
        <h1 className="text-xl font-semibold">Level 10 Meeting</h1>
        {!open && (
          <button
            onClick={handleStart}
            disabled={busy}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Start meeting
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {open ? (
        <section className="mt-4 rounded border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-medium">
                Meeting of {open.date}
                <span className="ml-2 text-xs font-normal text-slate-500">
                  total {fmtClock(open.totalElapsedSeconds)} elapsed ·{' '}
                  {open.segments.filter((s) => s.done).length}/{open.segments.length} segments done
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                Facilitator (advisory):{' '}
                {open.facilitatorName ?? 'none'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={open.facilitatorPersonId ?? ''}
                onChange={(e) => handleFacilitator(e.target.value ? Number(e.target.value) : null)}
                disabled={busy}
                className="rounded border border-slate-300 px-2 py-1 text-xs"
              >
                <option value="">Set facilitator…</option>
                {data.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
              </select>
              <button
                onClick={handleDelete}
                disabled={busy}
                className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
              >
                Delete meeting
              </button>
            </div>
          </div>

          <ol className="mt-4 space-y-2">
            {open.segments.map((s, i) => (
              <li
                key={s.id}
                className={
                  'flex items-center justify-between rounded border px-3 py-2 text-sm ' +
                  (s.active
                    ? 'border-blue-400 bg-blue-50'
                    : s.done
                      ? 'border-slate-200 bg-slate-50 text-slate-500'
                      : 'border-slate-200 bg-white')
                }
              >
                <div>
                  <span className="font-medium">
                    {i + 1}. {s.label}
                  </span>
                  <span className="ml-2 text-xs text-slate-400">
                    {s.done ? 'done' : s.active ? 'in progress' : 'upcoming'}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <SegmentTimer segment={s} now={now} />
                  {s.active && s.segmentKey !== 'conclude' && (
                    <button
                      onClick={() => handleAdvance(s)}
                      disabled={busy}
                      className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      Advance
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>

          {pre && (
            <div className="mt-4 grid grid-cols-1 gap-3 text-xs md:grid-cols-3">
              <div className="rounded border border-slate-200 p-3">
                <h3 className="font-medium text-slate-700">
                  Scorecard {pre.scorecard.previousWeekLabel ? `· ${pre.scorecard.previousWeekLabel}` : ''}
                </h3>
                {pre.scorecard.metrics.length === 0 ? (
                  <p className="mt-1 text-slate-400">No metrics defined.</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {pre.scorecard.metrics.map((m) => (
                      <li key={m.name} className="flex items-center justify-between gap-2">
                        <span className="truncate">{m.name}</span>
                        <span
                          className={
                            m.pass == null
                              ? 'text-slate-400'
                              : m.pass
                                ? 'text-green-600'
                                : 'font-semibold text-red-600'
                          }
                        >
                          {m.actual ?? '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="rounded border border-slate-200 p-3">
                <h3 className="font-medium text-slate-700">Rocks</h3>
                {pre.rocks.length === 0 ? (
                  <p className="mt-1 text-slate-400">No rocks this quarter.</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {pre.rocks.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-2">
                        <span className="truncate">{r.statement}</span>
                        <span
                          className={
                            r.twoConsecutiveOffTrack
                              ? 'font-semibold text-red-600'
                              : r.latestStatus === 'off_track'
                                ? 'text-red-500'
                                : r.latestStatus === 'on_track'
                                  ? 'text-green-600'
                                  : 'text-slate-400'
                          }
                        >
                          {r.latestStatus ?? 'unreported'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="rounded border border-slate-200 p-3">
                <h3 className="font-medium text-slate-700">
                  To-Dos {pre.todos ? `· ${pre.todos.label}` : ''}
                </h3>
                {!pre.todos ? (
                  <p className="mt-1 text-slate-400">No to-dos due last week.</p>
                ) : (
                  <>
                    <p className="mt-1 text-slate-500">
                      {pre.todos.done} done · {pre.todos.open} open · {pre.todos.dropped} dropped
                    </p>
                    <ul className="mt-1 space-y-1">
                      {pre.todos.items.map((t, i) => (
                        <li key={i} className="flex items-center justify-between gap-2">
                          <span className={'truncate ' + (t.status === 'done' ? 'line-through text-slate-400' : '')}>
                            {t.title}
                          </span>
                          <span className={t.status === 'open' ? 'font-semibold text-red-600' : 'text-slate-400'}>
                            {t.assigneeName}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          )}
        </section>
      ) : (
        <p className="mt-4 text-sm text-slate-500">
          No meeting is open. Start one to run this week's Level 10.
        </p>
      )}
      <HistoryList history={history} />
    </main>
  )
}
function HistoryList(props: { history: MeetingSummary[] }) {
  if (props.history.length === 0) {
    return <p className="mt-6 text-xs text-slate-400">No past meetings.</p>
  }
  return (
    <section className="mt-6">
      <h2 className="text-sm font-medium text-slate-700">History</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {props.history.map((m) => (
          <li
            key={m.id}
            className="flex items-center justify-between rounded border border-slate-200 px-3 py-1.5"
          >
            <span>
              {m.date}
              {m.status === 'open' ? ' (open)' : ' (concluded)'}
            </span>
            <span className="text-xs text-slate-400">
              {m.facilitatorName ? `facilitated by ${m.facilitatorName}` : 'no facilitator'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
