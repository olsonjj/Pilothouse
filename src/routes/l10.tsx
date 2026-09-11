import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
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
  saveSegmentNotesFn,
  pushRedCellFn,
  pushOffTrackRockFn,
  pushMissedTodoFn,
  pushHeadlineFn,
  listMeetingIssuesFn,
  removeMeetingIssueFn,
  pullLongTermIssuesFn,
  solveMeetingIssueFn,
} from '../functions/meetings'
import { listIssuesFn } from '../functions/issues'
import { getCurrentPeriodFn } from '../functions/quarters'
import type { MeetingWithSegments, SegmentView, MeetingSummary, MeetingIssueView } from '../server/meetings'

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

/** Drop one key from a records object (immutably). */
function omit(obj: Record<number, string>, key: number): Record<number, string> {
  const next = { ...obj }
  delete next[key]
  return next
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

/**
 * Per-segment autosaving notes (ticket 22): debounced 800ms after the last
 * keystroke via saveSegmentNotes; last-write-wins — the poll applies other
 * participants' notes whenever you are NOT editing this segment (skip-
 * while-editing UX: a focused/dirty textarea is never clobbered mid-typing).
 */
const NOTES_DEBOUNCE_MS = 800

function SegmentNotes(props: {
  meetingId: number
  segment: SegmentView
  draft: string
  editing: boolean
  savedTick: number
  onDraft: (segmentId: number, value: string) => void
  onEditingChange: (segmentId: number | null) => void
}) {
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    if (!props.savedTick) return
    setSaved(true)
    const t = setTimeout(() => setSaved(false), 1500)
    return () => clearTimeout(t)
  }, [props.savedTick])
  return (
    <div className="mt-2">
      <textarea
        value={props.draft}
        placeholder="segment notes…"
        onFocus={() => props.onEditingChange(props.segment.id)}
        onBlur={() => props.onEditingChange(null)}
        onChange={(e) => props.onDraft(props.segment.id, e.target.value)}
        rows={2}
        className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
      />
      <span className="text-[10px] text-slate-400">
        {saved ? 'saved' : props.editing ? 'editing…' : ''}
      </span>
    </div>
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
    case 'notes_too_large':
      return 'Notes are too large (100KB max).'
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

  // Notes drafts + editing state (ticket 22). drafts[segmentId] holds local
  // text; the poll never overwrites the segment being edited (skip-while-
  // editing) — server notes apply whenever the segment is not being edited.
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [editingId, setEditingId] = useState<number | null>(null)
  const [savedTicks, setSavedTicks] = useState<Record<number, number>>({})
  const saveTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})
  const saveInFlight = useRef(false)
  // IDS queue (ticket 23): polled with the meeting; headline input state.
  const [meetingIssues, setMeetingIssues] = useState<MeetingIssueView[]>([])
  const [headline, setHeadline] = useState('')

  // Polling (ticket 22): re-fetch the shared meeting state every 2.5s so all
  // participants see each other's updates within a few seconds (no SSE/
  // websockets — decided). Skipped while a notes save is in flight so the
  // response can't clobber the just-saved value; getMeeting is cheap (summary
  // + segments; pre-loads are NOT re-run per poll).
  useEffect(() => {
    if (!open) return
    const t = setInterval(async () => {
      if (saveInFlight.current) return
      const result = await getOpenMeetingFn()
      if (result.ok && result.value && result.value.id === open.id) {
        setOpen(result.value)
      }
      // IDS queue rides the same poll (cheap aliased join).
      const queue = await listMeetingIssuesFn({ data: { meetingId: open.id } })
      if (queue.ok) setMeetingIssues(queue.value)
    }, 2500)
    return () => clearInterval(t)
  }, [open?.id, open?.status])

  // Advisory tick for countdowns (1s; purely presentational).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Pre-loaded segment data refreshes with the open meeting.
  useEffect(() => {
    let cancelled = false
    if (open) {
      getPreloadedDataFn().then((r) => !cancelled && setPreloaded(r))
      listMeetingIssuesFn({ data: { meetingId: open.id } }).then((q) => {
        if (!cancelled && q.ok) setMeetingIssues(q.value)
      })
    }
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

  function handleDraft(segmentId: number, value: string) {
    setDrafts((d) => ({ ...d, [segmentId]: value }))
    // Debounced autosave: 800ms after the last keystroke (ticket 22).
    clearTimeout(saveTimers.current[segmentId])
    saveTimers.current[segmentId] = setTimeout(() => {
      void (async () => {
        if (!open) return
        saveInFlight.current = true
        const result = await saveSegmentNotesFn({
          data: { meetingId: open.id, segmentId, notes: value },
        })
        saveInFlight.current = false
        if (result.ok) {
          setSavedTicks((t) => ({ ...t, [segmentId]: Date.now() }))
          // Clear the draft only if the user hasn't typed more since scheduling.
          setDrafts((d) => (d[segmentId] === value ? omit(d, segmentId) : d))
        }
      })()
    }, NOTES_DEBOUNCE_MS)
  }

  async function handleSignOut() {
    await signOutFn()
    await navigate({ to: '/signin' })
  }

  // --- Ticket 23: one-click pushes + queue management. All participants can
  // push/remove; the queue re-polls so everyone sees pushes within seconds.
  async function push(action: () => Promise<{ ok: boolean; error?: string }>) {
    const ok = await run(action)
    if (open) {
      const q = await listMeetingIssuesFn({ data: { meetingId: open.id } })
      if (q.ok) setMeetingIssues(q.value)
    }
    return ok
  }

  async function handlePushRedCell(entryId: number) {
    if (!open) return
    await push(() => pushRedCellFn({ data: { meetingId: open.id, entryId } }))
  }

  async function handlePushRock(rockId: number) {
    if (!open) return
    await push(() => pushOffTrackRockFn({ data: { meetingId: open.id, rockId } }))
  }

  async function handlePushTodo(todoId: number) {
    if (!open) return
    await push(() => pushMissedTodoFn({ data: { meetingId: open.id, todoId } }))
  }

  async function handlePushHeadline() {
    if (!open || headline.trim() === '') return
    const ok = await push(() => pushHeadlineFn({ data: { meetingId: open.id, title: headline } }))
    if (ok) setHeadline('')
  }

  async function handleRemoveMeetingIssue(issueId: number) {
    if (!open) return
    await push(() => removeMeetingIssueFn({ data: { meetingId: open.id, issueId } }))
  }

  // --- Ticket 24: IDS pull + solve.
  const [pullables, setPullables] = useState<Array<{ id: number; title: string }>>([])
  const [pullSelection, setPullSelection] = useState<Record<number, boolean>>({})
  const [showPull, setShowPull] = useState(false)
  const [solvingId, setSolvingId] = useState<number | null>(null)
  const [solveNote, setSolveNote] = useState('')
  const [solveTodos, setSolveTodos] = useState<Array<{ title: string; assigneePersonId: number | null }>>([])

  async function openPullPanel() {
    if (!open) return
    // Unresolved long-term issues in the meeting's quarter (the team list IDS
    // pulls from). Current quarter via getCurrentPeriodFn — the room works
    // where the meeting is.
    setShowPull(true)
    const [period, all] = await Promise.all([getCurrentPeriodFn(), listIssuesFn()])
    const quarterId = period.ok ? period.value.quarter?.id : null
    if (!all.ok || quarterId == null) {
      setPullables([])
      return
    }
    setPullables(
      all.value.filter((i) => i.status === 'open' && i.classification === 'long_term' && i.quarterId === quarterId),
    )
  }

  async function handlePull() {
    if (!open) return
    const ids = Object.entries(pullSelection).filter(([, v]) => v).map(([k]) => Number(k))
    if (ids.length === 0) return
    const ok = await push(() => pullLongTermIssuesFn({ data: { meetingId: open.id, issueIds: ids } }))
    if (ok) {
      setPullSelection({})
      setShowPull(false)
    }
  }

  function openSolvePanel(mi: MeetingIssueView) {
    setSolvingId(mi.meetingIssueId)
    setSolveNote('')
    setSolveTodos([{ title: '', assigneePersonId: null }])
  }

  async function handleSolve() {
    if (!open || solvingId == null) return
    const ok = await push(() =>
      solveMeetingIssueFn({
        data: {
          meetingId: open.id,
          meetingIssueId: solvingId,
          note: solveNote,
          todos: solveTodos.filter((t) => t.title.trim() !== '' && t.assigneePersonId != null),
        },
      }),
    )
    if (ok) setSolvingId(null)
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
                  'rounded border px-3 py-2 text-sm ' +
                  (s.active
                    ? 'border-blue-400 bg-blue-50'
                    : s.done
                      ? 'border-slate-200 bg-slate-50 text-slate-500'
                      : 'border-slate-200 bg-white')
                }
              >
                <div className="flex items-center justify-between">
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
                </div>
                <SegmentNotes
                  meetingId={open.id}
                  segment={s}
                  draft={drafts[s.id] ?? s.notes}
                  editing={editingId === s.id}
                  savedTick={savedTicks[s.id] ?? 0}
                  onDraft={handleDraft}
                  onEditingChange={setEditingId}
                />
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
                        {open && m.pass === false && m.entryId != null && (
                          <button
                            onClick={() => handlePushRedCell(m.entryId!)}
                            disabled={busy}
                            title="Make this an issue"
                            className="shrink-0 rounded border border-red-300 px-1.5 py-0.5 text-[10px] text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            Make issue
                          </button>
                        )}
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
                        {open &&
                          (r.latestStatus === 'off_track' || r.twoConsecutiveOffTrack) && (
                            <button
                              onClick={() => handlePushRock(r.id)}
                              disabled={busy}
                              title="Make this an issue"
                              className="shrink-0 rounded border border-red-300 px-1.5 py-0.5 text-[10px] text-red-600 hover:bg-red-50 disabled:opacity-50"
                            >
                              Make issue
                            </button>
                          )}
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
                      {pre.todos.items.map((t) => (
                        <li key={t.id} className="flex items-center justify-between gap-2">
                          <span className={'truncate ' + (t.status === 'done' ? 'line-through text-slate-400' : '')}>
                            {t.title}
                          </span>
                          <span className="flex items-center gap-1">
                            <span className={t.status === 'open' ? 'font-semibold text-red-600' : 'text-slate-400'}>
                              {t.assigneeName}
                            </span>
                            {open && t.status !== 'done' && (
                              <button
                                onClick={() => handlePushTodo(t.id)}
                                disabled={busy}
                                title="Make this an issue"
                                className="shrink-0 rounded border border-red-300 px-1.5 py-0.5 text-[10px] text-red-600 hover:bg-red-50 disabled:opacity-50"
                              >
                                Make issue
                              </button>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          )}

          {/* IDS queue (ticket 23): pushed issues + the headline composer. */}
          {open && (
            <div className="mt-4 rounded border border-slate-200 bg-white p-3 text-xs">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-slate-700">IDS queue ({meetingIssues.length})</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => (showPull ? setShowPull(false) : void openPullPanel())}
                    disabled={busy}
                    className="rounded border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Pull from long-term list
                  </button>
                  <input
                    value={headline}
                    onChange={(e) => setHeadline(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void handlePushHeadline()}
                    placeholder="Headline…"
                    className="w-56 rounded border border-slate-300 px-2 py-1"
                  />
                  <button
                    onClick={handlePushHeadline}
                    disabled={busy || headline.trim() === ''}
                    className="rounded bg-slate-700 px-2 py-1 text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    Add headline as issue
                  </button>
                </div>
              </div>
              {showPull && (
                <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-2">
                  <p className="text-[10px] text-slate-500">Unresolved long-term issues (current quarter):</p>
                  {pullables.length === 0 ? (
                    <p className="mt-1 text-slate-400">Nothing to pull — the long-term list is clear.</p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {pullables.map((p) => (
                        <li key={p.id} className="flex items-center gap-2">
                          <label className="flex flex-1 items-center gap-2">
                            <input
                              type="checkbox"
                              checked={pullSelection[p.id] === true}
                              onChange={(e) => setPullSelection({ ...pullSelection, [p.id]: e.target.checked })}
                            />
                            <span className="truncate">{p.title}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    onClick={handlePull}
                    disabled={busy || !Object.values(pullSelection).some(Boolean)}
                    className="mt-2 rounded bg-blue-600 px-2 py-1 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    Pull selected
                  </button>
                </div>
              )}
              {meetingIssues.length === 0 ? (
                <p className="mt-2 text-slate-400">
                  Nothing queued yet — push red cells, off-track rocks, or missed to-dos above.
                </p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {meetingIssues.map((mi) => (
                    <li key={mi.meetingIssueId} className="rounded border border-slate-100 px-2 py-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">
                          {mi.title}{' '}
                          <span className="text-slate-400">
                            ({mi.origin === 'manual' ? 'headline/manual' : mi.origin.replace('from_', '')})
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className={mi.status === 'resolved' ? 'text-slate-400 line-through' : ''}>
                            {mi.state === 'in_ids' ? 'in IDS' : mi.state}
                          </span>
                          {mi.state === 'in_ids' && (
                            <>
                              <button
                                onClick={() => (solvingId === mi.meetingIssueId ? setSolvingId(null) : openSolvePanel(mi))}
                                disabled={busy}
                                title="Solve: capture resolution + assign to-dos"
                                className="rounded bg-green-600 px-1.5 py-0.5 text-[10px] text-white hover:bg-green-700 disabled:opacity-50"
                              >
                                Solve
                              </button>
                              <button
                                onClick={() => handleRemoveMeetingIssue(mi.issueId)}
                                disabled={busy}
                                title="Remove from queue (issue itself persists)"
                                className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                              >
                                Remove
                              </button>
                            </>
                          )}
                        </span>
                      </div>
                      {solvingId === mi.meetingIssueId && (
                        <div className="mt-2 border-t border-slate-100 pt-2">
                          <textarea
                            value={solveNote}
                            onChange={(e) => setSolveNote(e.target.value)}
                            placeholder="Resolution (what was decided)…"
                            rows={2}
                            className="w-full rounded border border-slate-300 px-2 py-1"
                          />
                          {solveTodos.map((t, i) => (
                            <div key={i} className="mt-1 flex items-center gap-2">
                              <input
                                value={t.title}
                                onChange={(e) =>
                                  setSolveTodos(solveTodos.map((s, j) => (j === i ? { ...s, title: e.target.value } : s)))
                                }
                                placeholder="New to-do…"
                                className="flex-1 rounded border border-slate-300 px-2 py-1"
                              />
                              <select
                                value={t.assigneePersonId ?? ''}
                                onChange={(e) =>
                                  setSolveTodos(
                                    solveTodos.map((s, j) =>
                                      j === i ? { ...s, assigneePersonId: e.target.value ? Number(e.target.value) : null } : s,
                                    ),
                                  )
                                }
                                className="rounded border border-slate-300 px-2 py-1"
                              >
                                <option value="">Assign to…</option>
                                {data.people.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.fullName}
                                  </option>
                                ))}
                              </select>
                              <button
                                onClick={() => setSolveTodos(solveTodos.filter((_, j) => j !== i))}
                                className="text-slate-400 hover:text-slate-600"
                                title="Remove to-do row"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                          <div className="mt-1 flex items-center gap-2">
                            <button
                              onClick={() => setSolveTodos([...solveTodos, { title: '', assigneePersonId: null }])}
                              className="text-[10px] text-blue-600 hover:underline"
                            >
                              + add to-do
                            </button>
                            <button
                              onClick={() => void handleSolve()}
                              disabled={busy || solveNote.trim() === ''}
                              className="rounded bg-green-600 px-2 py-1 text-white hover:bg-green-700 disabled:opacity-50"
                            >
                              Solve issue
                            </button>
                            <button
                              onClick={() => setSolvingId(null)}
                              className="rounded border border-slate-300 px-2 py-1 text-slate-500 hover:bg-slate-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
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
