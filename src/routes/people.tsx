import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { getCurrentUserFn, signOutFn } from '../functions/auth'
import {
  listPeopleFn,
  listUnlinkedUsersFn,
  createPersonFn,
  updatePersonFn,
  linkUserFn,
  unlinkUserFn,
} from '../functions/people'
import { getPersonAssignmentsFn } from '../functions/seats'
import type { AssignmentRow, GwcView } from '../server/seats'
import type { PersonWithAccount } from '../server/people'

export const Route = createFileRoute('/people')({
  loader: async () => {
    const [list, me] = await Promise.all([listPeopleFn(), getCurrentUserFn()])
    return { list, me: me.ok ? me.user : null }
  },
  component: PeoplePage,
})

type PersonFormState = {
  id: number | null
  fullName: string
  email: string
  startDate: string
}

const EMPTY_FORM: PersonFormState = { id: null, fullName: '', email: '', startDate: '' }

function errorText(error: string): string {
  switch (error) {
    case 'forbidden':
      return 'Only admins can do that.'
    case 'email_taken':
      return 'That email is already used by another person.'
    case 'name_required':
      return 'Name is required.'
    case 'invalid_date':
      return 'Start date must be a date (YYYY-MM-DD).'
    case 'already_linked':
      return 'That account or person is already linked.'
    case 'not_found':
      return 'That item no longer exists — refresh.'
    default:
      return 'Something went wrong.'
  }
}

function PeoplePage() {
  const navigate = useNavigate()
  const data = Route.useLoaderData()
  const isAdmin = data.me?.role === 'admin'

  const [people, setPeople] = useState<PersonWithAccount[]>(
    data.list.ok ? data.list.value : [],
  )
  const [editing, setEditing] = useState<PersonFormState | null>(null)
  const [editingPerson, setEditingPerson] = useState<PersonWithAccount | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    const result = await listPeopleFn()
    if (result.ok) setPeople(result.value)
  }

  async function handleSignOut() {
    await signOutFn()
    await navigate({ to: '/signin' })
  }

  function openCreate() {
    setFormError(null)
    setShowCreate(true)
    setEditingPerson(null)
    setEditing({ ...EMPTY_FORM })
  }

  function openEdit(person: PersonWithAccount) {
    setFormError(null)
    setShowCreate(false)
    setEditingPerson(person)
    setEditing({
      id: person.id,
      fullName: person.fullName,
      email: person.email ?? '',
      startDate: person.startDate ?? '',
    })
  }

  function closeEditor() {
    setEditing(null)
    setEditingPerson(null)
    setShowCreate(false)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editing) return
    setBusy(true)
    setFormError(null)
    const input = {
      fullName: editing.fullName,
      email: editing.email,
      startDate: editing.startDate,
    }
    const result = editing.id
      ? await updatePersonFn({ data: { id: editing.id, ...input } })
      : await createPersonFn({ data: input })
    setBusy(false)
    if (!result.ok) {
      setFormError(errorText(result.error))
      return
    }
    closeEditor()
    await refresh()
  }

  async function handleLink(personId: number, userId: number) {
    setBusy(true)
    setFormError(null)
    const result = await linkUserFn({ data: { userId, personId } })
    setBusy(false)
    if (!result.ok) {
      setFormError(errorText(result.error))
      return
    }
    await refresh()
  }

  async function handleUnlink(person: PersonWithAccount) {
    if (!person.linkedUser) return
    setBusy(true)
    setFormError(null)
    const result = await unlinkUserFn({ data: { userId: person.linkedUser.id } })
    setBusy(false)
    if (!result.ok) {
      setFormError(errorText(result.error))
      return
    }
    await refresh()
  }

  const detailOpen = editing !== null && isAdmin && showCreate
  const railPerson = editing !== null && isAdmin && !showCreate ? editingPerson : null

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
          <p className="label-sm">Team roster</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">People</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="badge badge-neutral">
            {people.length} {people.length === 1 ? 'member' : 'members'}
          </span>
          {isAdmin && (
            <Link to="/employee-assessment" className="btn-secondary">
              Employee Assessment
            </Link>
          )}
          {isAdmin && (
            <button onClick={openCreate} className="btn-primary">
              + Add person
            </button>
          )}
        </div>
      </div>

      {formError && (
        <p className="mt-4 rounded border border-crit-border bg-crit-surface px-3 py-2 text-sm text-crit-ink">
          {formError}
        </p>
      )}

      {detailOpen && editing && (
        <form
          onSubmit={handleSave}
          className="card mt-4 space-y-3 p-4"
        >
          <h2 className="text-base font-semibold">
            {showCreate ? 'New person' : 'Edit person'}
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="block text-sm">
              <span className="label-sm">Full name</span>
              <input
                required
                value={editing.fullName}
                onChange={(e) => setEditing({ ...editing, fullName: e.target.value })}
                className="input mt-1 w-full"
              />
            </label>
            <label className="block text-sm">
              <span className="label-sm">Email (optional)</span>
              <input
                type="email"
                value={editing.email}
                onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                className="input mt-1 w-full"
              />
            </label>
            <label className="block text-sm">
              <span className="label-sm">Start date (optional)</span>
              <input
                type="date"
                value={editing.startDate}
                onChange={(e) => setEditing({ ...editing, startDate: e.target.value })}
                className="input mt-1 w-full"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="btn-primary">
              Save
            </button>
            <button type="button" onClick={closeEditor} className="btn-secondary">
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className={railPerson ? 'mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_360px]' : 'mt-6'}>
        <table className="table-precision">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th className="num">Start date</th>
              <th>Account</th>
              {isAdmin && <th className="!text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {people.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 5 : 4} className="!h-14 text-center text-ink-faint">
                  No people yet.
                </td>
              </tr>
            )}
            {people.map((p) => (
              <tr
                key={p.id}
                className={
                  (isAdmin ? 'cursor-pointer' : '') +
                  (railPerson?.id === p.id ? ' bg-canvas' : '')
                }
                onClick={() => isAdmin && openEdit(p)}
              >
                <td className="font-medium">{p.fullName}</td>
                <td className="text-ink-secondary">{p.email ?? '—'}</td>
                <td className="num text-ink-secondary">{p.startDate ?? '—'}</td>
                <td>
                  {p.linkedUser ? (
                    <span className="badge badge-ok">{p.linkedUser.email}</span>
                  ) : (
                    <span className="badge badge-neutral">no login</span>
                  )}
                </td>
                {isAdmin && (
                  <td className="text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        openEdit(p)
                      }}
                      className="btn-secondary !h-7 !px-2.5 !text-xs"
                    >
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {railPerson && (
          <aside className="space-y-4">
            <div className="card-raised p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{railPerson.fullName}</h2>
                <button onClick={closeEditor} className="btn-ghost !h-7 !px-2 !text-xs">
                  Close
                </button>
              </div>

              <div className="mt-4">
                <h3 className="label-sm">Edit details</h3>
                <form onSubmit={handleSave} className="mt-2 space-y-3">
                  <label className="block text-sm">
                    <span className="label-sm">Full name</span>
                    <input
                      required
                      value={editing!.fullName}
                      onChange={(e) =>
                        setEditing({ ...editing!, fullName: e.target.value })
                      }
                      className="input mt-1 w-full"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="label-sm">Email (optional)</span>
                    <input
                      type="email"
                      value={editing!.email}
                      onChange={(e) => setEditing({ ...editing!, email: e.target.value })}
                      className="input mt-1 w-full"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="label-sm">Start date (optional)</span>
                    <input
                      type="date"
                      value={editing!.startDate}
                      onChange={(e) =>
                        setEditing({ ...editing!, startDate: e.target.value })
                      }
                      className="input mt-1 w-full"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button type="submit" disabled={busy} className="btn-primary">
                      Save
                    </button>
                    <button type="button" onClick={closeEditor} className="btn-secondary">
                      Cancel
                    </button>
                  </div>
                </form>
              </div>

              <AccountLinker
                person={railPerson}
                disabled={busy}
                onLink={(userId) => handleLink(railPerson.id, userId)}
                onUnlink={() => handleUnlink(railPerson)}
              />
            </div>

            <PersonAssignments personId={railPerson.id} />
          </aside>
        )}
      </div>
    </main>
  )
}

/** Link/unlink panel shown in the detail rail for an existing person. */
function AccountLinker(props: {
  person: PersonWithAccount
  disabled: boolean
  onLink: (userId: number) => void
  onUnlink: () => void
}) {
  const [unlinked, setUnlinked] = useState<Array<{ id: number; email: string; name: string }>>(
    [],
  )
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    listUnlinkedUsersFn().then((result) => {
      if (!cancelled && result.ok) setUnlinked(result.value)
    })
    return () => {
      cancelled = true
    }
  }, [props.person.linkedUser?.id])

  return (
    <div className="mt-4 border-t border-line pt-4">
      <h3 className="label-sm">Account</h3>
      {props.person.linkedUser ? (
        <div className="mt-2 flex items-center gap-3">
          <span className="badge badge-ok">{props.person.linkedUser.email}</span>
          <button onClick={props.onUnlink} disabled={props.disabled} className="btn-secondary !h-7 !px-2.5 !text-xs">
            Unlink account
          </button>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <select
            value={selectedUserId ?? ''}
            onChange={(e) => setSelectedUserId(e.target.value ? Number(e.target.value) : null)}
            className="input flex-1"
          >
            <option value="">Choose an account…</option>
            {unlinked.map((u) => (
              <option key={u.id} value={u.id}>
                {u.email}
              </option>
            ))}
          </select>
          <button
            onClick={() => selectedUserId && props.onLink(selectedUserId)}
            disabled={props.disabled || selectedUserId == null}
            className="btn-secondary"
          >
            Link account
          </button>
        </div>
      )}
    </div>
  )
}

/** Person detail: their seat history with stored Right Fit ratings (ticket 09). */
function PersonAssignments({ personId }: { personId: number }) {
  const [rows, setRows] = useState<AssignmentRow[] | null>(null)

  useEffect(() => {
    let cancelled = false
    getPersonAssignmentsFn({ data: { personId } }).then((result) => {
      if (!cancelled) setRows(result.ok ? result.value : [])
    })
    return () => {
      cancelled = true
    }
  }, [personId])

  return (
    <div className="card p-4">
      <h3 className="label-sm">Seat history</h3>
      {rows === null && <p className="mt-2 text-sm text-ink-faint">Loading…</p>}
      {rows != null && rows.length === 0 && (
        <p className="mt-2 text-sm text-ink-faint">No seat assignments yet.</p>
      )}
      {rows != null && rows.length > 0 && (
        <ul className="mt-2 space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded border border-line px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{r.seatName}</span>
                {r.endedAt == null ? (
                  <span className="badge badge-ok">current</span>
                ) : (
                  <span className="badge badge-neutral">ended</span>
                )}
              </div>
              <div className="tnum mt-0.5 font-mono text-xs text-ink-secondary">
                {r.startedAt} → {r.endedAt ?? 'current'}
              </div>
              <GwcLine gwc={r.gwc} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function GwcLine({ gwc }: { gwc: GwcView }) {
  if (gwc.get == null && gwc.want == null && gwc.capacity == null && !gwc.note) return null
  const mark = (v: boolean | null) => (v == null ? '—' : v ? '✓' : '✗')
  return (
    <div className="tnum mt-1 font-mono text-xs text-ink-muted">
      Right Fit — Get {mark(gwc.get)} · Want {mark(gwc.want)} · Capacity {mark(gwc.capacity)}
      {gwc.note ? <span className="font-sans italic"> “{gwc.note}”</span> : null}
    </div>
  )
}