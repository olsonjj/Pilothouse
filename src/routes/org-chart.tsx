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

  return (
    <main className="mx-auto max-w-4xl p-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-sm text-blue-600 hover:underline">
            ← Home
          </Link>
          <Link to="/people" className="text-sm text-blue-600 hover:underline">
            People
          </Link>
        </div>
        <button
          onClick={handleSignOut}
          className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
        >
          Sign out
        </button>
      </header>

      <div className="mt-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Org Chart</h1>
        {isAdmin && (
          <button
            onClick={() => openCreate(null)}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
          >
            Add top seat
          </button>
        )}
      </div>

      {formError && <p className="mt-2 text-sm text-red-600">{formError}</p>}

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
        <form
          onSubmit={handleAssign}
          className="mt-4 flex items-end gap-3 rounded border border-slate-200 bg-white p-4 shadow-sm"
        >
          <label className="block text-sm">
            <span className="text-slate-700">Person</span>
            <select
              value={assignPersonId ?? ''}
              onChange={(e) => setAssignPersonId(e.target.value ? Number(e.target.value) : null)}
              className="mt-1 block rounded border border-slate-300 px-3 py-2"
            >
              <option value="">Choose a person…</option>
              {(data.people.ok ? data.people.value : []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Assign
          </button>
          <button
            type="button"
            onClick={() => setAssignSeatId(null)}
            className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100"
          >
            Cancel
          </button>
        </form>
      )}

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <section>
          {seats.length === 0 ? (
            <p className="rounded border border-dashed border-slate-300 p-6 text-center text-slate-400">
              No seats yet.
            </p>
          ) : (
            <ul className="space-y-1">
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
            </ul>
          )}
        </section>

        <section>
          {detail ? (
            <SeatDetail
              detail={detail}
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
            <p className="rounded border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
              Select a seat to see its detail, occupants, and history.
            </p>
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
    <form
      onSubmit={props.onSubmit}
      className="mt-4 space-y-3 rounded border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="font-medium">{form.id ? 'Edit seat' : 'New seat'}</h2>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="text-slate-700">Name</span>
          <input
            required
            value={form.name}
            onChange={(e) => props.onChange({ ...form, name: e.target.value })}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-700">Parent seat</span>
          <select
            value={form.parentSeatId ?? ''}
            onChange={(e) =>
              props.onChange({ ...form, parentSeatId: e.target.value ? Number(e.target.value) : null })
            }
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
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
        <span className="text-slate-700">Responsibilities (one per line, in order)</span>
        <textarea
          rows={4}
          value={form.responsibilities}
          onChange={(e) => props.onChange({ ...form, responsibilities: e.target.value })}
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2 font-mono text-xs"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={props.busy}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={props.onCancel}
          className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

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
  return (
    <li className="mt-2">
      <div
        className={
          'flex items-center justify-between rounded border px-3 py-2 text-sm ' +
          (empty ? 'border-dashed border-slate-300 bg-slate-50' : 'border-slate-300 bg-white') +
          (props.selectedSeatId === seat.id ? ' ring-2 ring-blue-400' : '')
        }
      >
        <button className="text-left hover:underline" onClick={() => props.onSelect(seat.id)}>
          <span className="font-medium">{seat.name}</span>{' '}
          <span className={empty ? 'text-slate-400' : 'text-slate-600'}>
            {empty ? 'empty seat' : seat.occupants.map((o) => o.personName).join(' · ')}
          </span>
        </button>
        {props.isAdmin && (
          <span className="flex gap-1 text-xs">
            <button
              onClick={() => props.onEdit(seat)}
              className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-100"
            >
              Edit
            </button>
            <button
              onClick={() => props.onAssign(seat.id)}
              className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-100"
            >
              Assign
            </button>
            <button
              onClick={() => props.onAddChild(seat.id)}
              className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-100"
            >
              + Seat
            </button>
          </span>
        )}
      </div>
      {children.length > 0 && (
        <div className="ml-6 border-l border-slate-300 pl-4">
          {children.map((child) => (
            <SeatNode
              key={child.id}
              {...props}
              seat={child}
              seen={new Set([...seen, child.id])}
            />
          ))}
        </div>
      )}
    </li>
  )
}

function SeatDetail(props: {
  detail: SeatWithOccupants & { history: AssignmentRow[] }
  isAdmin: boolean
  busy: boolean
  onEnd: (assignmentId: number) => void
  onSetGwc: (assignmentId: number, input: GwcInput) => Promise<boolean>
  onEdit: () => void
  onAssign: () => void
}) {
  const seat = props.detail
  return (
    <div className="rounded border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">{seat.name}</h2>
          {seat.description && <p className="mt-1 text-sm text-slate-600">{seat.description}</p>}
        </div>
        {props.isAdmin && (
          <span className="flex gap-2 text-xs">
            <button
              onClick={props.onEdit}
              className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
            >
              Edit seat
            </button>
            <button
              onClick={props.onAssign}
              className="rounded bg-blue-600 px-2 py-1 text-white hover:bg-blue-700"
            >
              Assign person
            </button>
          </span>
        )}
      </div>

      <h3 className="mt-4 text-sm font-medium text-slate-700">Responsibilities</h3>
      <ol className="mt-1 list-decimal pl-5 text-sm text-slate-600">
        {seat.responsibilities.map((r: string, i: number) => (
          <li key={i}>{r}</li>
        ))}
        {seat.responsibilities.length === 0 && <li className="list-none text-slate-400">None set.</li>}
      </ol>

      <h3 className="mt-4 text-sm font-medium text-slate-700">Current occupants</h3>
      {seat.occupants.length === 0 && <p className="mt-1 text-sm text-slate-600">Empty seat.</p>}
      {seat.occupants.map((o) => (
        <OccupantGwc
          key={o.assignmentId}
          occupant={o}
          isAdmin={props.isAdmin}
          busy={props.busy}
          onSetGwc={props.onSetGwc}
        />
      ))}

      <h3 className="mt-4 text-sm font-medium text-slate-700">Assignment history</h3>
      <ul className="mt-1 space-y-1 text-sm text-slate-600">
        {seat.history.length === 0 && <li className="text-slate-400">No assignments yet.</li>}
        {seat.history.map((h) => (
          <li key={h.id} className="flex items-center justify-between">
            <span>
              {h.personName} — {h.startedAt} → {h.endedAt ?? 'current'}
              <GwcSummary gwc={h.gwc} />
            </span>
            {props.isAdmin && h.endedAt == null && (
              <button
                disabled={props.busy}
                onClick={() => props.onEnd(h.id)}
                className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100 disabled:opacity-50"
              >
                End
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
/** Compact read-only GWC line: "G ✓ W — C ✗" style; hidden when unrated. */
function GwcSummary({ gwc }: { gwc: GwcView }) {
  if (gwc.get == null && gwc.want == null && gwc.capacity == null && !gwc.note) return null
  const mark = (v: boolean | null) => (v == null ? '—' : v ? '✓' : '✗')
  return (
    <span className="ml-2 text-xs text-slate-500">
      [G {mark(gwc.get)} · W {mark(gwc.want)} · C {mark(gwc.capacity)}]
      {gwc.note ? <span className="italic"> “{gwc.note}”</span> : null}
    </span>
  )
}

/** Occupant row with read-only GWC for members, inline editor for admins. */
function OccupantGwc(props: {
  occupant: { assignmentId: number; personName: string; startedAt: string; gwc: GwcView }
  isAdmin: boolean
  busy: boolean
  onSetGwc: (assignmentId: number, input: GwcInput) => Promise<boolean>
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
    <div className="mt-1 rounded border border-slate-200 p-2 text-sm">
      <div className="flex items-center justify-between">
        <span>
          {o.personName} <span className="text-slate-400">(since {o.startedAt})</span>
          {!editing && <GwcSummary gwc={o.gwc} />}
        </span>
        {props.isAdmin && !editing && (
          <button
            onClick={openEditor}
            className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100"
          >
            Right Fit
          </button>
        )}
      </div>
      {editing && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {(['get', 'want', 'capacity'] as const).map((k) => (
            <label key={k} className="flex items-center gap-1 text-xs">
              <span className="uppercase text-slate-500">{k}</span>
              <select
                value={draft[k] == null ? '' : draft[k] ? 'yes' : 'no'}
                disabled={props.busy}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    [k]: e.target.value === '' ? null : e.target.value === 'yes',
                  })
                }
                className="rounded border border-slate-300 px-1.5 py-0.5"
              >
                <option value="">—</option>
                <option value="yes">✓</option>
                <option value="no">✗</option>
              </select>
            </label>
          ))}
          <input
            value={draft.note ?? ''}
            disabled={props.busy}
            maxLength={1000}
            placeholder="note (optional)"
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            className="flex-1 rounded border border-slate-300 px-2 py-0.5 text-xs"
          />
          <button
            onClick={save}
            disabled={props.busy}
            className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Save Right Fit
          </button>
          <button
            onClick={() => setEditing(false)}
            className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
