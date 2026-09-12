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
        <h1 className="text-xl font-semibold">People</h1>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <Link
              to="/employee-assessment"
              className="text-sm text-blue-600 hover:underline"
            >
              Employee Assessment
            </Link>
          )}
          {isAdmin && (
            <button
              onClick={openCreate}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
            >
              Add person
            </button>
          )}
        </div>
      </div>

      {formError && <p className="mt-2 text-sm text-red-600">{formError}</p>}

      {editing && isAdmin && (
        <form
          onSubmit={handleSave}
          className="mt-4 space-y-3 rounded border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 className="font-medium">{showCreate ? 'New person' : 'Edit person'}</h2>
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm">
              <span className="text-slate-700">Full name</span>
              <input
                required
                value={editing.fullName}
                onChange={(e) => setEditing({ ...editing, fullName: e.target.value })}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-700">Email (optional)</span>
              <input
                type="email"
                value={editing.email}
                onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-700">Start date (optional)</span>
              <input
                type="date"
                value={editing.startDate}
                onChange={(e) => setEditing({ ...editing, startDate: e.target.value })}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              />
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

      {editing && isAdmin && !showCreate && editingPerson && (
        <>
          <AccountLinker
            person={editingPerson}
            disabled={busy}
            onLink={(userId) => handleLink(editingPerson.id, userId)}
            onUnlink={() => handleUnlink(editingPerson)}
          />
          <PersonAssignments personId={editingPerson.id} />
        </>
      )}

      <table className="mt-6 w-full rounded border border-slate-200 bg-white text-sm shadow-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Email</th>
            <th className="px-4 py-2 font-medium">Start date</th>
            <th className="px-4 py-2 font-medium">Account</th>
            {isAdmin && <th className="px-4 py-2" />}
          </tr>
        </thead>
        <tbody>
          {people.length === 0 && (
            <tr>
              <td colSpan={isAdmin ? 5 : 4} className="px-4 py-6 text-center text-slate-400">
                No people yet.
              </td>
            </tr>
          )}
          {people.map((p) => (
            <tr
              key={p.id}
              className={
                'border-b border-slate-100 last:border-0' +
                (isAdmin ? ' cursor-pointer hover:bg-slate-50' : '') +
                (editingPerson?.id === p.id ? ' bg-blue-50' : '')
              }
              onClick={() => isAdmin && openEdit(p)}
            >
              <td className="px-4 py-2 font-medium">{p.fullName}</td>
              <td className="px-4 py-2 text-slate-600">{p.email ?? '—'}</td>
              <td className="px-4 py-2 text-slate-600">{p.startDate ?? '—'}</td>
              <td className="px-4 py-2 text-slate-600">
                {p.linkedUser ? p.linkedUser.email : 'no login'}
              </td>
              {isAdmin && (
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      openEdit(p)
                    }}
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

/** Link/unlink panel shown under the edit form for an existing person. */
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
    <div className="mt-3 rounded border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-medium text-slate-700">Login account</h3>
      {props.person.linkedUser ? (
        <div className="mt-2 flex items-center gap-3">
          <span className="text-sm text-slate-600">{props.person.linkedUser.email}</span>
          <button
            onClick={props.onUnlink}
            disabled={props.disabled}
            className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-50"
          >
            Unlink account
          </button>
        </div>
      ) : (
        <div className="mt-1 flex items-center gap-2">
          <select
            value={selectedUserId ?? ''}
            onChange={(e) => setSelectedUserId(e.target.value ? Number(e.target.value) : null)}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm"
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
            className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50"
          >
            Link account
          </button>
        </div>
      )}
    </div>
  )
}
/** Person detail: their seat history with stored GWC (ticket 09). */
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
    <div className="mt-3 rounded border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-medium text-slate-700">Seats &amp; Right Fit</h3>
      {rows === null && <p className="mt-1 text-sm text-slate-400">Loading…</p>}
      {rows != null && rows.length === 0 && (
        <p className="mt-1 text-sm text-slate-400">No seat assignments yet.</p>
      )}
      {rows != null && rows.length > 0 && (
        <ul className="mt-1 space-y-1 text-sm text-slate-600">
          {rows.map((r) => (
            <li key={r.id}>
              {r.seatName} — {r.startedAt} → {r.endedAt ?? 'current'}
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
    <span className="ml-2 text-xs text-slate-500">
      Right Fit — Get {mark(gwc.get)} · Want {mark(gwc.want)} · Capacity {mark(gwc.capacity)}
      {gwc.note ? <span className="italic"> “{gwc.note}”</span> : null}
    </span>
  )
}
