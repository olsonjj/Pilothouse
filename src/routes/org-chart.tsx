import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { getCurrentUserFn, signOutFn } from '../functions/auth'
import { listPeopleFn } from '../functions/people'
import { setGwcFn } from '../functions/seats'
import type { GwcView } from '../server/seats'
import {
  listSeatsFn,
  getSeatFn,
  createSeatFn,
  updateSeatFn,
  createAssignmentFn,
  endAssignmentFn,
} from '../functions/seats'
import type { SeatWithOccupants, AssignmentRow, GwcInput } from "../server/seats"

export const Route = createFileRoute('/org-chart')({
  validateSearch: (search: Record<string, unknown>) => {
    const n = search.seat ? Number(search.seat) : NaN
    return { seat: Number.isFinite(n) ? (n as number | null) : (null as number | null) }
  },
  loader: async () => {
    const [me, seats, people] = await Promise.all([
      getCurrentUserFn(),
      listSeatsFn(),
      listPeopleFn(),
    ])
    return { me, seats, people }
  },
  component: ChartPage,
})

type SeatFormState = {
  id: number | null
  name: string
  description: string
  /** Multi-line textarea; split on newlines into the ordered bullets. */
  responsibilities: string
  parentSeatId: number | null
  sortOrder: number
}

const EMPTY_SEAT_FORM: SeatFormState = {
  id: null,
  name: '',
  description: '',
  responsibilities: '',
  parentSeatId: null,
  sortOrder: 0,
}

function errorText(error: string): string {
  switch (error) {
    case 'forbidden':
      return 'Only admins can do that.'
    case 'name_required':
      return 'Seat name is required.'
    case 'not_found':
      return 'That item no longer exists — refresh.'
    case 'cycle':
      return 'That parent would create a loop in the chart.'
    case 'invalid_date':
      return 'Dates must be YYYY-MM-DD (and end after start).'
    case 'invalid_input':
      return 'Invalid input.'
    case 'person_seat_limit':
      return 'That person already holds two seats.'
    case 'seat_occupied':
      return 'That seat already has an active occupant.'
    case 'already_ended':
      return 'That assignment is already ended.'
    case 'unauthenticated':
      return 'Sign in first.'
    default:
      return 'Something went wrong.'
  }
}

function ChartPage() {
  const navigate = useNavigate()
  const data = Route.useLoaderData()
  const searchSeat = Route.useSearch().seat
  const isAdmin = data.me.ok && data.me.user?.role === 'admin'
  const [dataSeats, setDataSeats] = useState<SeatWithOccupants[]>(
    data.seats.ok ? data.seats.value : [],
  )
  const seats = dataSeats
  const [detail, setDetail] = useState<SeatWithOccupants & { history: AssignmentRow[] } | null>(
    null,
  )
  const selectedSeatId = detail?.id ?? null
  const filledCount = seats.filter((s) => s.occupants.length > 0).length
  const openCount = seats.length - filledCount

  useEffect(() => {
    let cancelled = false
    if (searchSeat == null) {
      setDetail(null)
      return
    }
    getSeatFn({ data: { seatId: searchSeat } }).then((result) => {
      if (!cancelled) setDetail(result.ok ? result.value : null)
    })
    return () => {
      cancelled = true
    }
  }, [searchSeat, data.seats])

  const [seatForm, setSeatForm] = useState<SeatFormState | null>(null)
  const [assignSeatId, setAssignSeatId] = useState<number | null>(null)
  const [assignPersonId, setAssignPersonId] = useState<number | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    const result = await listSeatsFn()
    if (result.ok) setDataSeats(result.value)
    // Re-fetch the open seat detail too: navigating to the same search params
    // doesn't re-run the loader, so detail would otherwise go stale after a
    // mutation (assign/end).
    if (selectedSeatId != null) {
      const seatResult = await getSeatFn({ data: { seatId: selectedSeatId } })
      setDetail(seatResult.ok ? seatResult.value : null)
    }
    await navigate({ to: '/org-chart', search: { seat: selectedSeatId }, replace: true })
  }

  async function handleSignOut() {
    await signOutFn()
    await navigate({ to: '/signin' })
  }

  function openCreate(parentSeatId: number | null = null) {
    setFormError(null)
    setSeatForm({ ...EMPTY_SEAT_FORM, parentSeatId })
  }

  function openEdit(seat: SeatWithOccupants) {
    setFormError(null)
    setSeatForm({
      id: seat.id,
      name: seat.name,
      description: seat.description ?? '',
      responsibilities: seat.responsibilities.join('\n'),
      parentSeatId: seat.parentSeatId,
      sortOrder: seat.sortOrder,
    })
  }

  async function handleSeatSave(e: React.FormEvent) {
    e.preventDefault()
    if (!seatForm) return
    setBusy(true)
    setFormError(null)
    const responsibilities = seatForm.responsibilities.split('\n')
    const result = seatForm.id
      ? await updateSeatFn({
          data: {
            seatId: seatForm.id,
            name: seatForm.name,
            description: seatForm.description,
            responsibilities,
            parentSeatId: seatForm.parentSeatId,
            sortOrder: seatForm.sortOrder,
          },
        })
      : await createSeatFn({
          data: {
            name: seatForm.name,
            description: seatForm.description,
            responsibilities,
            parentSeatId: seatForm.parentSeatId,
            sortOrder: seatForm.sortOrder,
          },
        })
    setBusy(false)
    if (!result.ok) {
      setFormError(errorText(result.error))
      return
    }
    setSeatForm(null)
    await refresh()
  }

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault()
    if (!assignSeatId || !assignPersonId) return
    setBusy(true)
    setFormError(null)
    const result = await createAssignmentFn({
      data: { seatId: assignSeatId, personId: assignPersonId },
    })
    setBusy(false)
    if (!result.ok) {
      setFormError(errorText(result.error))
      return
    }
    setAssignSeatId(null)
    setAssignPersonId(null)
    await refresh()
  }

  async function handleEnd(assignmentId: number) {
    setBusy(true)
    setFormError(null)
    const result = await endAssignmentFn({ data: { assignmentId } })
    setBusy(false)
    if (!result.ok) {
      setFormError(errorText(result.error))
      return
    }
    await refresh()
  }

  async function handleSetGwc(assignmentId: number, input: GwcInput): Promise<boolean> {
    setBusy(true)
    setFormError(null)
    const result = await setGwcFn({ data: { assignmentId, ...input } })
    setBusy(false)
    if (!result.ok) {
      setFormError(errorText(result.error))
      return false
    }
    await refresh()
    return true
  }

  const detailParentName =
    detail?.parentSeatId != null
      ? (seats.find((s) => s.id === detail.parentSeatId)?.name ?? null)
      : null

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
          <p className="label-sm">Accountability architecture</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Org Chart</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="badge badge-neutral">
            {seats.length} {seats.length === 1 ? 'seat' : 'seats'} configured
          </span>
          {openCount > 0 && <span className="badge badge-crit">{openCount} open</span>}
          {isAdmin && (
            <button onClick={() => openCreate(null)} className="btn-primary">
              Add top seat
            </button>
          )}
        </div>
      </div>

      {formError && (
        <p className="mt-4 rounded border border-crit-border bg-crit-surface px-3 py-2 text-sm text-crit-ink">
          {formError}
        </p>
      )}

      {seatForm && isAdmin && (
        <SeatEditor
          form={seatForm}
          seats={seats}
          busy={busy}
          onChange={setSeatForm}
          onCancel={() => setSeatForm(null)}
          onSubmit={handleSeatSave}
        />
      )}

      {assignSeatId != null && isAdmin && (
        <form onSubmit={handleAssign} className="card mt-4 flex flex-wrap items-end gap-3 p-4">
          <label className="block text-sm">
            <span className="label-sm">Person</span>
            <select
              value={assignPersonId ?? ''}
              onChange={(e) => setAssignPersonId(e.target.value ? Number(e.target.value) : null)}
              className="input mt-1 block"
            >
              <option value="">Choose a person…</option>
              {(data.people.ok ? data.people.value : []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy} className="btn-primary">
            Assign
          </button>
          <button type="button" onClick={() => setAssignSeatId(null)} className="btn-secondary">
            Cancel
          </button>
        </form>
      )}

      <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="label-sm">Seat hierarchy</span>
            <span className="label-sm tnum">
              {filledCount} filled · {openCount} empty
            </span>
          </div>
          <div className="overflow-x-auto p-6">
            {seats.length === 0 ? (
              <p className="rounded border border-dashed border-ruler p-6 text-center text-sm text-ink-faint">
                No seats yet.
              </p>
            ) : (
              <div className="flex w-max min-w-full items-start justify-center gap-12">
                {seats
                  .filter((s) => s.parentSeatId == null)
                  .map((top) => (
                    <SeatNode
                      key={top.id}
                      seat={top}
                      allSeats={seats}
                      selectedSeatId={selectedSeatId}
                      isAdmin={isAdmin}
                      onSelect={(id) => navigate({ to: '/org-chart', search: { seat: id } })}
                      onEdit={openEdit}
                      onAssign={(id) => {
                        setFormError(null)
                        setAssignSeatId(id)
                        setAssignPersonId(null)
                      }}
                      onAddChild={(parentId) => openCreate(parentId)}
                    />
                  ))}
              </div>
            )}
          </div>
        </section>

        <section>
          {detail ? (
            <SeatDetail
              detail={detail}
              parentName={detailParentName}
              isAdmin={isAdmin}
              busy={busy}
              onEnd={handleEnd}
              onSetGwc={handleSetGwc}
              onEdit={() => openEdit(detail)}
              onAssign={() => {
                setFormError(null)
                setAssignSeatId(detail.id)
                setAssignPersonId(null)
              }}
            />
          ) : (
            <div className="card p-6 text-sm text-ink-muted">
              Select a seat to see its detail, occupants, and history.
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function SeatEditor(props: {
  form: SeatFormState
  seats: SeatWithOccupants[]
  busy: boolean
  onChange: (form: SeatFormState) => void
  onCancel: () => void
  onSubmit: (e: React.FormEvent) => void
}) {
  const { form } = props
  return (
    <form onSubmit={props.onSubmit} className="card mt-4 space-y-3 p-4">
      <h2 className="text-base font-semibold">{form.id ? 'Edit seat' : 'New seat'}</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="block text-sm">
          <span className="label-sm">Name</span>
          <input
            required
            value={form.name}
            onChange={(e) => props.onChange({ ...form, name: e.target.value })}
            className="input mt-1 w-full"
          />
        </label>
        <label className="block text-sm">
          <span className="label-sm">Parent seat</span>
          <select
            value={form.parentSeatId ?? ''}
            onChange={(e) =>
              props.onChange({ ...form, parentSeatId: e.target.value ? Number(e.target.value) : null })
            }
            className="input mt-1 w-full"
          >
            <option value="">(top seat)</option>
            {props.seats
              .filter((s) => s.id !== form.id)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      <label className="block text-sm">
        <span className="label-sm">Responsibilities (one per line, in order)</span>
        <textarea
          rows={4}
          value={form.responsibilities}
          onChange={(e) => props.onChange({ ...form, responsibilities: e.target.value })}
          className="input mt-1 w-full font-mono text-xs"
        />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={props.busy} className="btn-primary">
          Save
        </button>
        <button type="button" onClick={props.onCancel} className="btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  )
}

/**
 * Boxes-and-lines tree: parent box, then a centered stem dropping into a
 * sibling row where each child draws half-trunk connectors via before/after
 * pseudo-elements (first child drops its left half, last child its right
 * half, so the trunk spans exactly between the outer children's centers).
 */
function SeatNode(props: {
  seat: SeatWithOccupants
  allSeats: SeatWithOccupants[]
  selectedSeatId: number | null
  isAdmin: boolean
  onSelect: (seatId: number) => void
  onEdit: (seat: SeatWithOccupants) => void
  onAssign: (seatId: number) => void
  onAddChild: (parentSeatId: number) => void
  /** Guard against corrupted parent chains (direct DB tampering): seats already rendered. */
  seen?: Set<number>
}) {
  const { seat } = props
  const seen = props.seen ?? new Set([seat.id])
  const children = props.allSeats.filter(
    (s) => s.parentSeatId === seat.id && !seen.has(s.id),
  )
  const empty = seat.occupants.length === 0
  const selected = props.selectedSeatId === seat.id
  const fullyCalibrated =
    !empty && seat.occupants.every((o) => o.gwc.get === true && o.gwc.want === true && o.gwc.capacity === true)
  return (
    <div className="flex flex-col items-center">
      <div
        className={
          'w-full max-w-[240px] rounded-lg border px-3 py-2.5 ' +
          (empty
            ? 'border-dashed border-ruler bg-canvas'
            : 'border-line bg-sheet shadow-[0_1px_2px_0_rgba(15,23,42,0.04)]') +
          (selected ? ' border-beacon shadow-[0_0_0_3px_var(--color-beacon-ring)]' : '')
        }
      >
        <button className="block w-full text-left" onClick={() => props.onSelect(seat.id)}>
          <span className="label-sm block truncate">{seat.name}</span>
          <span
            className={
              'mt-1 block truncate text-sm font-medium ' +
              (empty ? 'text-ink-faint' : 'text-ink')
            }
          >
            {empty ? 'Empty seat' : seat.occupants.map((o) => o.personName).join(' · ')}
          </span>
          {fullyCalibrated && (
            <span className="badge badge-ok mt-1.5 !h-5 !text-[10px]">Right Fit ✓</span>
          )}
        </button>
        {props.isAdmin && (
          <span className="mt-2 flex gap-1.5 border-t border-line-soft pt-2">
            <button
              onClick={() => props.onEdit(seat)}
              className="btn-secondary !h-6 !px-2 !text-[11px]"
            >
              Edit
            </button>
            <button
              onClick={() => props.onAssign(seat.id)}
              className="btn-secondary !h-6 !px-2 !text-[11px]"
            >
              Assign
            </button>
            <button
              onClick={() => props.onAddChild(seat.id)}
              className="btn-secondary !h-6 !px-2 !text-[11px]"
            >
              + Seat
            </button>
          </span>
        )}
      </div>
      {children.length > 0 && (
        <>
          {/* Stem: parent box down to the sibling trunk. */}
          <span aria-hidden className="h-6 w-px bg-ruler" />
          <div className="flex items-start justify-center">
            {children.map((child, i) => (
              <div
                key={child.id}
                className={
                  'relative flex flex-col items-center px-3 pt-6 ' +
                  (children.length === 1
                    ? '!pt-0 before:hidden after:hidden '
                    : (i === 0
                        ? ''
                        : 'before:absolute before:top-0 before:right-1/2 before:h-6 before:w-1/2 before:border-t before:border-ruler ') +
                      'after:absolute after:top-0 after:left-1/2 after:h-6 after:w-1/2 after:border-l after:border-ruler ' +
                      (i === children.length - 1 ? '' : 'after:border-t '))
                }
              >
                <SeatNode
                  {...props}
                  seat={child}
                  seen={new Set([...seen, child.id])}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function SeatDetail(props: {
  detail: SeatWithOccupants & { history: AssignmentRow[] }
  parentName: string | null
  isAdmin: boolean
  busy: boolean
  onEnd: (assignmentId: number) => void
  onSetGwc: (assignmentId: number, input: GwcInput) => Promise<boolean>
  onEdit: () => void
  onAssign: () => void
}) {
  const seat = props.detail
  return (
    <div className="card-raised p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label-sm">Selected seat</p>
          <h2 className="mt-1 text-lg font-semibold">{seat.name}</h2>
          {props.parentName ? (
            <p className="tnum mt-0.5 font-mono text-xs text-ink-muted">
              Reports directly to: {props.parentName}
            </p>
          ) : (
            seat.parentSeatId == null && (
              <p className="tnum mt-0.5 font-mono text-xs text-ink-muted">Top-level seat</p>
            )
          )}
          {seat.description && <p className="mt-2 text-sm text-ink-secondary">{seat.description}</p>}
        </div>
        {props.isAdmin && (
          <span className="flex flex-shrink-0 gap-2">
            <button onClick={props.onEdit} className="btn-secondary !h-7 !px-2.5 !text-xs">
              Edit seat
            </button>
            <button onClick={props.onAssign} className="btn-primary !h-7 !px-2.5 !text-xs">
              Assign person
            </button>
          </span>
        )}
      </div>

      <h3 className="label-sm mt-5">Responsibilities</h3>
      <ol className="mt-2 space-y-1.5">
        {seat.responsibilities.map((r: string, i: number) => (
          <li key={i} className="flex gap-2.5 text-sm text-ink-secondary">
            <span className="tnum flex-shrink-0 font-mono text-xs text-ink-muted">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span>{r}</span>
          </li>
        ))}
        {seat.responsibilities.length === 0 && (
          <li className="text-sm text-ink-faint">None set.</li>
        )}
      </ol>

      <h3 className="label-sm mt-5">Current occupants</h3>
      {seat.occupants.length === 0 && <p className="mt-2 text-sm text-ink-faint">Empty seat.</p>}
      {seat.occupants.map((o) => (
        <OccupantGwc
          key={o.assignmentId}
          occupant={o}
          isAdmin={props.isAdmin}
          busy={props.busy}
          onSetGwc={props.onSetGwc}
          onEnd={props.onEnd}
        />
      ))}

      <h3 className="label-sm mt-5">Assignment history</h3>
      <ul className="mt-1 divide-y divide-line-soft">
        {seat.history.length === 0 && (
          <li className="py-2 text-sm text-ink-faint">No assignments yet.</li>
        )}
        {seat.history.map((h) => (
          <li key={h.id} className="flex items-start justify-between gap-3 py-2">
            <div>
              <span className="text-sm font-medium">{h.personName}</span>
              <span className="tnum ml-2 font-mono text-xs text-ink-muted">
                {h.startedAt} → {h.endedAt ?? 'current'}
              </span>
              <GwcSummary gwc={h.gwc} />
            </div>
            {props.isAdmin && h.endedAt == null && (
              <span className="badge badge-ok">current</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Compact read-only Right Fit line: "Get ✓ · Want — · Capacity ✗" style; hidden when unrated. */
function GwcSummary({ gwc }: { gwc: GwcView }) {
  if (gwc.get == null && gwc.want == null && gwc.capacity == null && !gwc.note) return null
  const mark = (v: boolean | null) => (v == null ? '—' : v ? '✓' : '✗')
  return (
    <div className="tnum mt-1 font-mono text-xs text-ink-muted">
      Right Fit — Get {mark(gwc.get)} · Want {mark(gwc.want)} · Capacity {mark(gwc.capacity)}
      {gwc.note ? <span className="font-sans italic"> “{gwc.note}”</span> : null}
    </div>
  )
}

/** Occupant row with read-only GWC for members, inline editor for admins. */
function OccupantGwc(props: {
  occupant: { assignmentId: number; personName: string; startedAt: string; gwc: GwcView }
  isAdmin: boolean
  busy: boolean
  onSetGwc: (assignmentId: number, input: GwcInput) => Promise<boolean>
  onEnd: (assignmentId: number) => void
}) {
  const { occupant: o } = props
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<GwcInput>({
    get: o.gwc.get,
    want: o.gwc.want,
    capacity: o.gwc.capacity,
    note: o.gwc.note,
  })

  function openEditor() {
    setDraft({ get: o.gwc.get, want: o.gwc.want, capacity: o.gwc.capacity, note: o.gwc.note })
    setEditing(true)
  }

  async function save() {
    const ok = await props.onSetGwc(o.assignmentId, draft)
    if (ok) setEditing(false)
  }

  return (
    <div className="mt-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="text-sm font-medium">{o.personName}</span>
          <span className="tnum ml-2 font-mono text-xs text-ink-muted">since {o.startedAt}</span>
        </span>
        {props.isAdmin && !editing && (
          <span className="flex gap-2">
            <button
              onClick={openEditor}
              className="btn-secondary !h-7 !px-2.5 !text-xs"
            >
              Right Fit
            </button>
            <button
              disabled={props.busy}
              onClick={() => props.onEnd(o.assignmentId)}
              className="btn-ghost !h-7 !px-2.5 !text-xs !text-crit-ink hover:!bg-crit-surface hover:!text-crit-ink"
            >
              Unassign
            </button>
          </span>
        )}
      </div>
      {!editing && <GwcSummary gwc={o.gwc} />}
      {editing && (
        <div className="mt-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(['get', 'want', 'capacity'] as const).map((k) => (
              <label key={k} className="block text-sm">
                <span className="label-sm">{k}</span>
                <select
                  value={draft[k] == null ? '' : draft[k] ? 'yes' : 'no'}
                  disabled={props.busy}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      [k]: e.target.value === '' ? null : e.target.value === 'yes',
                    })
                  }
                  className="input mt-1 w-full"
                >
                  <option value="">—</option>
                  <option value="yes">✓</option>
                  <option value="no">✗</option>
                </select>
              </label>
            ))}
          </div>
          <label className="mt-2 block text-sm">
            <span className="label-sm">Note (optional)</span>
            <input
              value={draft.note ?? ''}
              disabled={props.busy}
              maxLength={1000}
              placeholder="Add a note…"
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              className="input mt-1 w-full"
            />
          </label>
          <div className="mt-3 flex gap-2">
            <button
              onClick={save}
              disabled={props.busy}
              className="btn-primary !h-8 !px-3 !text-xs"
            >
              Save Right Fit
            </button>
            <button
              onClick={() => setEditing(false)}
              className="btn-secondary !h-8 !px-3 !text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}