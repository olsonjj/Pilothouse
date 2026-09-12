import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { getCurrentUserFn, signOutFn } from '../functions/auth'
import { listPeopleFn } from '../functions/people'
import {
  getMeetingFn,
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
  concludeMeetingFn,
  setRatingFn,
  listMeetingRecapFn,
  ratingTrendFn,
} from '../functions/meetings'
import { listIssuesFn } from '../functions/issues'
import { getCurrentPeriodFn } from '../functions/quarters'
import type {
  MeetingWithSegments,
  SegmentView,
  MeetingSummary,
  MeetingIssueView,
  MeetingRecap,
  MeetingTrendPoint,
} from '../server/meetings'

export const Route = createFileRoute('/meeting')({
  loader: async () => {
    const [me, people, open, history, trend] = await Promise.all([
      getCurrentUserFn(),
      listPeopleFn(),
      getOpenMeetingFn(),
      listMeetingsFn(),
      ratingTrendFn(),
    ])
    return {
      me: me.ok ? me.user : null,
      people: people.ok ? people.value : [],
      open: open.ok ? open.value : null,
      history: history.ok ? history.value : [],
      trend: trend.ok ? trend.value : [],
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
    return (
      <span className="tnum font-mono text-xs text-ink-secondary">
        {fmtClock(segment.elapsedSeconds)} used
      </span>
    )
  }
  if (!segment.active) {
    return <span className="tnum text-xs text-ink-faint">{segment.plannedMinutes} min</span>
  }
  const elapsed = Math.max(0, Math.floor((props.now - Date.parse(segment.enteredAt!)) / 1000))
  const planned = segment.plannedMinutes * 60
  const remaining = planned - elapsed
  // Lit countdown on the navy active card: pale green nominal, amber when over.
  return (
    <span
      className={
        'tnum font-mono text-xs font-semibold ' +
        (remaining < 0 ? 'text-warn-border' : 'text-ok-border')
      }
    >
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
    <div className="mt-1">
      <textarea
        value={props.draft}
        placeholder="segment notes…"
        onFocus={() => props.onEditingChange(props.segment.id)}
        onBlur={() => props.onEditingChange(null)}
        onChange={(e) => props.onDraft(props.segment.id, e.target.value)}
        rows={2}
        className="input w-full !text-xs"
      />
      <span className="text-[10px] text-ink-faint">
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
    case 'conclude_explicit':
      return 'The last segment does not advance — use the Conclude button below.'
    case 'person_required':
      return 'Link your account to a person before rating (People page).'
    case 'invalid_score':
      return 'Rating must be a whole number from 1 to 10.'
    case 'person_not_found':
      return 'That person no longer exists.'
    case 'notes_too_large':
      return 'Notes are too large (100KB max).'
    default:
      return 'Something went wrong.'
  }
}

/** Queue origin → badge pill text ("from data" / "from goal" / "from to-do" / "from meeting"). */
function originLabel(origin: string): string {
  switch (origin) {
    case 'manual':
    case 'from_meeting':
      return 'from meeting'
    case 'from_data':
      return 'from data'
    case 'from_goal':
      return 'from goal'
    case 'from_todo':
      return 'from to-do'
    default:
      return origin.startsWith('from_') ? origin.replace('from_', 'from ') : origin
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
  // Issue queue (ticket 23): polled with the meeting; headline input state.
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
      // Issue queue rides the same poll (cheap aliased join).
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

  useEffect(() => {
    if (!open) {
      setRecap(null)
      return
    }
    let cancelled = false
    listMeetingRecapFn({ data: { meetingId: open.id } }).then((result) => {
      if (!cancelled && result.ok) setRecap(result.value)
    })
    return () => {
      cancelled = true
    }
  }, [open?.id, meetingIssues.length])

  async function handleConclude() {
    if (!open) return
    setBusy(true)
    const result = await concludeMeetingFn({ data: { meetingId: open.id } })
    setBusy(false)
    if (!result.ok) {
      setError(errorText(result.error))
      return
    }
    setOpen(null)
    setRecap(null)
    await refreshHistory()
  }

  async function handleRate() {
    if (!open || myScore == null) return
    setBusy(true)
    const result = await setRatingFn({ data: { meetingId: open.id, score: myScore } })
    setBusy(false)
    if (!result.ok) {
      setError(errorText(result.error))
      return
    }
    setRecap(result.value)
    setMyScore(null)
  }

  async function openFrozen(meetingId: number) {
    const [meeting, recapResult] = await Promise.all([
      getMeetingFn({ data: { meetingId } }),
      listMeetingRecapFn({ data: { meetingId } }),
    ])
    if (meeting.ok) setFrozen(meeting.value)
    if (recapResult.ok) setFrozenRecap(recapResult.value)
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
  const [recap, setRecap] = useState<MeetingRecap | null>(null)
  const [myScore, setMyScore] = useState<number | null>(null)
  const [frozen, setFrozen] = useState<MeetingWithSegments | null>(null)
  const [frozenRecap, setFrozenRecap] = useState<MeetingRecap | null>(null)
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
  const doneCount = open ? open.segments.filter((s) => s.done).length : 0

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
          <p className="label-sm">Weekly cadence</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Weekly Meeting</h1>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded border border-crit-border bg-crit-surface px-3 py-2 text-sm text-crit-ink">
          {error}
        </p>
      )}

      {open ? (
        <section className="card mt-4">
          {/* Cockpit header: meeting identity, elapsed timer, progress, facilitator, delete */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3">
            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
              <h2 className="text-base font-semibold">Meeting of {open.date}</h2>
              <span className="timer-pill ok tnum">
                {fmtClock(open.totalElapsedSeconds)} total elapsed
              </span>
              <span className="tnum text-xs font-medium text-ink-secondary">
                {doneCount}/{open.segments.length} segments done
              </span>
              <span className="text-xs text-ink-muted">
                Facilitator (advisory): {open.facilitatorName ?? 'none'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={open.facilitatorPersonId ?? ''}
                onChange={(e) => handleFacilitator(e.target.value ? Number(e.target.value) : null)}
                disabled={busy}
                className="input !h-8 !text-xs"
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
                className="btn-secondary !h-8 !border-crit-border !px-2.5 !text-xs !text-crit-ink hover:!bg-crit-surface"
              >
                Delete meeting
              </button>
            </div>
          </div>

          {/* Segment rail: active lit navy with mono countdown, done checked with
              actual durations, upcoming dimmed with planned minutes. */}
          <ol className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4 lg:grid-cols-7">
            {open.segments.map((s, i) => (
              <li
                key={s.id}
                className={
                  'flex flex-col justify-between rounded-lg border p-2.5 ' +
                  (s.active
                    ? 'border-navy bg-navy text-white shadow-[0_4px_6px_-2px_rgba(15,23,42,0.25)]'
                    : s.done
                      ? 'border-line bg-canvas text-ink-secondary'
                      : 'border-line bg-white text-ink-faint')
                }
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={
                      'label-sm !tracking-normal ' + (s.active ? '!text-white/70' : '')
                    }
                  >
                    {String(i + 1).padStart(2, '0')} · {s.label}
                  </span>
                  {s.active ? (
                    <span className="badge badge-warn !h-4 !px-1.5 !text-[9px]">active</span>
                  ) : s.done ? (
                    <span className="font-mono text-xs font-semibold text-ok-dot">✓</span>
                  ) : null}
                </div>
                <div className="mt-2 flex items-end justify-between gap-2">
                  <SegmentTimer segment={s} now={now} />
                  {!s.active && !s.done && (
                    <span className="text-[10px] uppercase tracking-wide">upcoming</span>
                  )}
                  {s.active && s.segmentKey !== 'conclude' && (
                    <button
                      onClick={() => handleAdvance(s)}
                      disabled={busy}
                      className="shrink-0 rounded bg-white px-2 py-1 text-[11px] font-semibold text-navy transition-colors hover:bg-canvas disabled:opacity-50"
                    >
                      Advance
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>

          {/* Per-segment notes with autosave */}
          <div className="border-t border-line px-4 py-3">
            <p className="label-sm">Segment notes · autosave</p>
            <div className="mt-2 space-y-2">
              {open.segments.map((s, i) => (
                <div
                  key={s.id}
                  className={
                    s.active
                      ? 'rounded border border-beacon/40 bg-canvas px-3 py-2'
                      : 'px-3 py-1'
                  }
                >
                  <span className="label-sm">
                    {i + 1}. {s.label}
                  </span>
                  <SegmentNotes
                    meetingId={open.id}
                    segment={s}
                    draft={drafts[s.id] ?? s.notes}
                    editing={editingId === s.id}
                    savedTick={savedTicks[s.id] ?? 0}
                    onDraft={handleDraft}
                    onEditingChange={setEditingId}
                  />
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : (
        <div className="card mt-4 flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-ink-secondary">
            No meeting is open. Start one to run this week's weekly meeting.
          </p>
          <button onClick={handleStart} disabled={busy} className="btn-primary shrink-0">
            Start meeting
          </button>
        </div>
      )}

      {open && (
        <div className="mt-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          {/* Pre-loads: three hairline-separated panels (Data · Goals · To-Dos) */}
          <section className={pre ? 'card divide-y divide-line' : 'hidden xl:block'}>
            {pre && (
            <>
            <div className="p-4">
              <h3 className="label-sm">
                Data {pre.scorecard.previousWeekLabel ? `· ${pre.scorecard.previousWeekLabel}` : ''}
              </h3>
              {pre.scorecard.metrics.length === 0 ? (
                <p className="mt-2 text-sm text-ink-faint">No metrics defined.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {pre.scorecard.metrics.map((m) => (
                    <li key={m.name} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate">{m.name}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span
                          className={
                            'tnum font-mono ' +
                            (m.pass == null
                              ? 'text-ink-faint'
                              : m.pass
                                ? 'text-ink'
                                : 'font-semibold text-crit-ink')
                          }
                        >
                          {m.actual ?? '—'}
                        </span>
                        {m.pass === true && <span className="badge badge-ok">Pass</span>}
                        {m.pass === false && <span className="badge badge-crit">Fail</span>}
                        {open && m.pass === false && m.entryId != null && (
                          <button
                            onClick={() => handlePushRedCell(m.entryId!)}
                            disabled={busy}
                            title="Make this an issue"
                            className="shrink-0 rounded border border-crit-border bg-white px-1.5 py-0.5 text-[10px] font-medium text-crit-ink transition-colors hover:bg-crit-surface disabled:opacity-50"
                          >
                            Make issue
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="p-4">
              <h3 className="label-sm">Goals</h3>
              {pre.rocks.length === 0 ? (
                <p className="mt-2 text-sm text-ink-faint">No goals this quarter.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {pre.rocks.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate">{r.statement}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span
                          className={
                            r.twoConsecutiveOffTrack
                              ? 'badge badge-crit font-semibold'
                              : r.latestStatus === 'off_track'
                                ? 'badge badge-crit'
                                : r.latestStatus === 'on_track'
                                  ? 'badge badge-ok'
                                  : 'badge badge-neutral'
                          }
                        >
                          {(r.latestStatus ?? 'unreported').replace(/_/g, ' ')}
                        </span>
                        {open &&
                          (r.latestStatus === 'off_track' || r.twoConsecutiveOffTrack) && (
                            <button
                              onClick={() => handlePushRock(r.id)}
                              disabled={busy}
                              title="Make this an issue"
                              className="shrink-0 rounded border border-crit-border bg-white px-1.5 py-0.5 text-[10px] font-medium text-crit-ink transition-colors hover:bg-crit-surface disabled:opacity-50"
                            >
                              Make issue
                            </button>
                          )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="p-4">
              <h3 className="label-sm">
                To-Dos {pre.todos ? `· ${pre.todos.label}` : ''}
              </h3>
              {!pre.todos ? (
                <p className="mt-2 text-sm text-ink-faint">No to-dos due last week.</p>
              ) : (
                <>
                  <p className="tnum mt-2 text-xs text-ink-secondary">
                    {pre.todos.done} done · {pre.todos.open} open · {pre.todos.dropped} dropped
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {pre.todos.items.map((t) => (
                      <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
                        <span
                          className={
                            'truncate ' +
                            (t.status === 'done' ? 'text-ink-faint line-through' : '')
                          }
                        >
                          {t.title}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span
                            className={
                              t.status === 'open'
                                ? 'font-semibold text-crit-ink'
                                : 'text-ink-faint'
                            }
                          >
                            {t.assigneeName}
                          </span>
                          {open && t.status !== 'done' && (
                            <button
                              onClick={() => handlePushTodo(t.id)}
                              disabled={busy}
                              title="Make this an issue"
                              className="shrink-0 rounded border border-crit-border bg-white px-1.5 py-0.5 text-[10px] font-medium text-crit-ink transition-colors hover:bg-crit-surface disabled:opacity-50"
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
            </>
            )}
          </section>

          <div className="space-y-4">
            {/* Issue queue: pull-from-long-term, headline composer, origin badges, inline solve */}
            <section className="card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
                <h3 className="text-sm font-semibold">Issue queue ({meetingIssues.length})</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => (showPull ? setShowPull(false) : void openPullPanel())}
                    disabled={busy}
                    className="btn-secondary !h-8 !px-2.5 !text-xs"
                  >
                    Pull from long-term list
                  </button>
                  <input
                    value={headline}
                    onChange={(e) => setHeadline(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void handlePushHeadline()}
                    placeholder="Headline…"
                    className="input !h-8 w-56 !text-xs"
                  />
                  <button
                    onClick={handlePushHeadline}
                    disabled={busy || headline.trim() === ''}
                    className="btn-primary !h-8 !px-2.5 !text-xs"
                  >
                    Add headline as issue
                  </button>
                </div>
              </div>
              <div className="p-4">
                {showPull && (
                  <div className="mb-3 rounded border border-line bg-canvas p-3">
                    <p className="label-sm">Unresolved long-term issues (current quarter)</p>
                    {pullables.length === 0 ? (
                      <p className="mt-1.5 text-sm text-ink-faint">
                        Nothing to pull — the long-term list is clear.
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-1.5">
                        {pullables.map((p) => (
                          <li key={p.id} className="flex items-center gap-2 text-sm">
                            <label className="flex flex-1 items-center gap-2">
                              <input
                                type="checkbox"
                                checked={pullSelection[p.id] === true}
                                onChange={(e) =>
                                  setPullSelection({ ...pullSelection, [p.id]: e.target.checked })
                                }
                                className="h-4 w-4 rounded accent-navy"
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
                      className="btn-primary mt-3 !h-8 !px-2.5 !text-xs"
                    >
                      Pull selected
                    </button>
                  </div>
                )}
                {meetingIssues.length === 0 ? (
                  <p className="text-sm text-ink-faint">
                    Nothing queued yet — push red cells, off-track goals, or missed to-dos above.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {meetingIssues.map((mi) => (
                      <li key={mi.meetingIssueId} className="rounded border border-line px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="flex min-w-0 flex-wrap items-center gap-2">
                            <span
                              className={
                                'truncate text-sm ' +
                                (mi.status === 'resolved'
                                  ? 'text-ink-faint line-through'
                                  : 'font-medium')
                              }
                            >
                              {mi.title}
                            </span>
                            <span className="badge badge-neutral !h-5 !px-1.5 !text-[10px]">
                              {originLabel(mi.origin)}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <span
                              className={
                                'text-xs ' +
                                (mi.status === 'resolved'
                                  ? 'text-ink-faint line-through'
                                  : 'text-ink-secondary')
                              }
                            >
                              {mi.state === 'in_ids' ? 'in Issues' : mi.state}
                            </span>
                            {mi.state === 'in_ids' && (
                              <>
                                <button
                                  onClick={() =>
                                    solvingId === mi.meetingIssueId
                                      ? setSolvingId(null)
                                      : openSolvePanel(mi)
                                  }
                                  disabled={busy}
                                  title="Solve: capture resolution + assign to-dos"
                                  className="btn-primary !h-7 !px-2 !text-[11px]"
                                >
                                  Solve
                                </button>
                                <button
                                  onClick={() => handleRemoveMeetingIssue(mi.issueId)}
                                  disabled={busy}
                                  title="Remove from queue (issue itself persists)"
                                  className="btn-secondary !h-7 !px-2 !text-[11px]"
                                >
                                  Remove
                                </button>
                              </>
                            )}
                          </span>
                        </div>
                        {solvingId === mi.meetingIssueId && (
                          <div className="mt-2 border-t border-line pt-2">
                            <textarea
                              value={solveNote}
                              onChange={(e) => setSolveNote(e.target.value)}
                              placeholder="Resolution (what was decided)…"
                              rows={2}
                              className="input w-full !text-xs"
                            />
                            {solveTodos.map((t, i) => (
                              <div key={i} className="mt-1.5 flex items-center gap-2">
                                <input
                                  value={t.title}
                                  onChange={(e) =>
                                    setSolveTodos(
                                      solveTodos.map((s, j) =>
                                        j === i ? { ...s, title: e.target.value } : s,
                                      ),
                                    )
                                  }
                                  placeholder="New to-do…"
                                  className="input !h-8 flex-1 !text-xs"
                                />
                                <select
                                  value={t.assigneePersonId ?? ''}
                                  onChange={(e) =>
                                    setSolveTodos(
                                      solveTodos.map((s, j) =>
                                        j === i
                                          ? {
                                              ...s,
                                              assigneePersonId: e.target.value
                                                ? Number(e.target.value)
                                                : null,
                                            }
                                          : s,
                                      ),
                                    )
                                  }
                                  className="input !h-8 !text-xs"
                                >
                                  <option value="">Assign to…</option>
                                  {data.people.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.fullName}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  onClick={() =>
                                    setSolveTodos(solveTodos.filter((_, j) => j !== i))
                                  }
                                  className="btn-ghost !h-7 !px-1.5 !text-xs"
                                  title="Remove to-do row"
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                            <div className="mt-2 flex items-center gap-2">
                              <button
                                onClick={() =>
                                  setSolveTodos([...solveTodos, { title: '', assigneePersonId: null }])
                                }
                                className="btn-ghost !h-7 !px-1.5 !text-[11px]"
                              >
                                + add to-do
                              </button>
                              <button
                                onClick={() => void handleSolve()}
                                disabled={busy || solveNote.trim() === ''}
                                className="btn-primary !h-8 !px-2.5 !text-xs"
                              >
                                Solve issue
                              </button>
                              <button
                                onClick={() => setSolvingId(null)}
                                className="btn-secondary !h-8 !px-2.5 !text-xs"
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
            </section>

            {/* Conclude panel (ticket 25): amber caution zone — recap, ratings, freeze */}
            <section className="rounded-lg border border-warn-border bg-warn-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-warn-ink">
                  <span aria-hidden>⚠</span> Conclude
                </h3>
                {recap && (
                  <span className="tnum text-xs text-warn-ink">
                    {recap.newTodos.length} new to-do{recap.newTodos.length === 1 ? '' : 's'} ·{' '}
                    {recap.carriedCount} to carry back · avg rating {recap.avgRating ?? '—'}
                  </span>
                )}
              </div>
              {recap && recap.newTodos.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs font-semibold text-warn-ink">New to-dos this meeting:</p>
                  <ul className="tnum mt-1 space-y-0.5 text-xs text-warn-ink">
                    {recap.newTodos.map((t) => (
                      <li key={t.id} className="truncate">
                        {t.title} <span className="font-medium">→ {t.assigneeName}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-warn-ink">
                  Your 1–10 rating
                  {data.me?.personId == null ? ' (link your account to a person first)' : ''}:
                </span>
                <select
                  value={myScore ?? ''}
                  onChange={(e) => setMyScore(e.target.value ? Number(e.target.value) : null)}
                  disabled={busy || data.me?.personId == null}
                  className="input !h-8 w-auto !border-warn-border !text-xs"
                >
                  <option value="">Rate…</option>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleRate}
                  disabled={busy || myScore == null || data.me?.personId == null}
                  className="btn-secondary !h-8 !border-warn-border !px-2.5 !text-xs !text-warn-ink hover:!bg-warn-surface"
                >
                  Save rating
                </button>
                <button
                  onClick={handleConclude}
                  disabled={busy}
                  className="btn-primary ml-auto"
                >
                  Conclude meeting (freeze)
                </button>
              </div>
              {recap && recap.ratings.length > 0 && (
                <p className="tnum mt-2 text-xs text-warn-ink">
                  Ratings so far:{' '}
                  {recap.ratings.map((r) => `${r.personName}: ${r.score}`).join(' · ')}
                </p>
              )}
              <p className="mt-2 text-[11px] leading-relaxed text-warn-ink/80">
                Cascading messages live in the Conclude segment's notes (editable above).
                Concluding flips unsolved queue issues back to the long-term list and freezes
                notes/issues/to-dos/durations; ratings stay open for late raters.
              </p>
            </section>
          </div>
        </div>
      )}
      {frozen && (
        <FrozenArchive
          meeting={frozen}
          recap={frozenRecap}
          onClose={() => {
            setFrozen(null)
            setFrozenRecap(null)
          }}
        />
      )}
      <HistoryList
        history={history}
        trend={data.trend}
        onOpenArchive={(id) => void openFrozen(id)}
      />
    </main>
  )
}

function HistoryList(props: {
  history: MeetingSummary[]
  trend: MeetingTrendPoint[]
  onOpenArchive: (meetingId: number) => void
}) {
  if (props.history.length === 0) {
    return <p className="mt-6 text-sm text-ink-faint">No past meetings.</p>
  }
  const avg = new Map(props.trend.map((t) => [t.meetingId, t.avgRating]))
  return (
    <section className="mt-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">History</h2>
        <span className="label-sm">Avg rating trend</span>
      </div>
      <table className="table-precision mt-2">
        <thead>
          <tr>
            <th>Date</th>
            <th>Status</th>
            <th>Facilitator</th>
            <th className="num">Avg rating</th>
            <th className="!text-right">Archive</th>
          </tr>
        </thead>
        <tbody>
          {props.history.map((m) => (
            <tr key={m.id}>
              <td className="tnum font-medium">{m.date}</td>
              <td>
                {m.status === 'open' ? (
                  <span className="badge badge-warn">open</span>
                ) : (
                  <span className="badge badge-neutral">concluded</span>
                )}
              </td>
              <td className="text-ink-secondary">
                {m.facilitatorName ? `facilitated by ${m.facilitatorName}` : 'no facilitator'}
              </td>
              <td className="num text-ink-secondary">
                {m.status === 'concluded' ? (avg.get(m.id) ?? '—') : '—'}
              </td>
              <td className="text-right">
                {m.status === 'concluded' && (
                  <button
                    onClick={() => props.onOpenArchive(m.id)}
                    className="btn-secondary !h-7 !px-2 !text-[11px]"
                  >
                    View archive
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

/** Read-only concluded-meeting archive (ticket 25): notes, durations, recap, ratings. */
function FrozenArchive(props: {
  meeting: MeetingWithSegments
  recap: MeetingRecap | null
  onClose: () => void
}) {
  return (
    <section className="card mt-6">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-base font-semibold">
          Archive — meeting of {props.meeting.date} (concluded)
        </h2>
        <button onClick={props.onClose} className="btn-ghost !h-7 !px-2 !text-xs">
          Close
        </button>
      </div>
      <div className="p-4">
        <p className="tnum text-xs text-ink-secondary">
          Total {fmtClock(props.meeting.totalElapsedSeconds)} · frozen{' '}
          {props.meeting.concludedAt ?? ''} · read-only (ratings remain open for late raters)
        </p>
        {props.recap && (
          <div className="tnum mt-2 text-xs text-ink-secondary">
            <p>
              New to-dos: {props.recap.newTodos.length} · carried back:{' '}
              {props.recap.carriedCount} · avg rating: {props.recap.avgRating ?? '—'}
            </p>
            {props.recap.ratings.length > 0 && (
              <p className="mt-1">
                Ratings: {props.recap.ratings.map((r) => `${r.personName}: ${r.score}`).join(' · ')}
              </p>
            )}
            {props.recap.cascadingMessages.trim() !== '' && (
              <p className="mt-1">
                <span className="font-medium">Cascading messages:</span>{' '}
                {props.recap.cascadingMessages}
              </p>
            )}
          </div>
        )}
        <table className="table-precision mt-3">
          <thead>
            <tr>
              <th className="w-8">#</th>
              <th>Segment</th>
              <th className="num">Duration</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {props.meeting.segments.map((s, i) => (
              <tr key={s.id}>
                <td className="tnum font-mono text-xs text-ink-faint">
                  {String(i + 1).padStart(2, '0')}
                </td>
                <td className="font-medium">{s.label}</td>
                <td className="num text-ink-secondary">{fmtClock(s.elapsedSeconds)}</td>
                <td className="whitespace-pre-wrap text-ink-secondary">
                  {s.notes.trim() !== '' ? s.notes : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}