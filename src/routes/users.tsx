import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { getCurrentUserFn, signOutFn } from '../functions/auth'
import {
  listUsersFn,
  createUserFn,
  resetPasswordFn,
  setRoleFn,
} from '../functions/userManagement'
import type { ManagedUser } from '../server/userManagement'

export const Route = createFileRoute('/users')({
  loader: async () => {
    const [list, me] = await Promise.all([listUsersFn(), getCurrentUserFn()])
    return { list, me: me.ok ? me.user : null }
  },
  component: UsersPage,
})

const MIN_PASSWORD_LENGTH = 8

type CreateForm = { email: string; name: string; password: string; role: 'admin' | 'member' }
const EMPTY_FORM: CreateForm = { email: '', name: '', password: '', role: 'member' }

function errorText(error: string): string {
  switch (error) {
    case 'forbidden':
      return 'Only admins can manage users.'
    case 'unauthenticated':
      return 'Sign in first.'
    case 'email_required':
      return 'Email is required.'
    case 'email_invalid':
      return 'That does not look like an email address.'
    case 'email_taken':
      return 'That email already has a login.'
    case 'name_required':
      return 'Name is required.'
    case 'password_required':
      return 'Password is required.'
    case 'password_too_short':
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    case 'invalid_role':
      return 'Role must be admin or member.'
    case 'not_found':
      return 'That account no longer exists — refresh.'
    case 'self_role_change':
      return "You can't change your own role."
    default:
      return 'Something went wrong.'
  }
}

function UsersPage() {
  const navigate = useNavigate()
  const data = Route.useLoaderData()
  const isAdmin = data.me?.role === 'admin'
  const meId = data.me?.id ?? null

  const [users, setUsers] = useState<ManagedUser[]>(data.list.ok ? data.list.value : [])
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [rowMessage, setRowMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    const result = await listUsersFn()
    if (result.ok) setUsers(result.value)
  }

  async function handleSignOut() {
    await signOutFn()
    await navigate({ to: '/signin' })
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setFormError(null)
    const result = await createUserFn({ data: form })
    setBusy(false)
    if (!result.ok) {
      setFormError(errorText(result.error))
      return
    }
    setForm(EMPTY_FORM)
    await refresh()
  }

  async function handleReset(user: ManagedUser) {
    const pw = window.prompt(
      `New password for ${user.email} (min ${MIN_PASSWORD_LENGTH} chars — all their sessions are signed out):`,
    )
    if (pw == null) return
    setBusy(true)
    setRowMessage(null)
    const result = await resetPasswordFn({ data: { userId: user.id, password: pw } })
    setBusy(false)
    if (!result.ok) {
      setRowMessage(`${user.email}: ${errorText(result.error)}`)
      return
    }
    setRowMessage(`${user.email}: password reset — their sessions were signed out.`)
  }

  async function handleRole(user: ManagedUser, role: 'admin' | 'member') {
    if (role === user.role) return
    setBusy(true)
    setRowMessage(null)
    const result = await setRoleFn({ data: { userId: user.id, role } })
    setBusy(false)
    if (!result.ok) {
      setRowMessage(`${user.email}: ${errorText(result.error)}`)
      await refresh()
      return
    }
    await refresh()
  }

  if (!isAdmin) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <header className="flex items-center justify-between">
          <Link to="/" className="btn-ghost">
            ← Home
          </Link>
          <button onClick={handleSignOut} className="btn-ghost">
            Sign out
          </button>
        </header>
        <div className="mt-8 card p-6">
          <p className="label-sm">Administration</p>
          <p className="mt-2 text-sm text-[var(--color-ink-secondary)]">
            Only admins can manage users.
          </p>
        </div>
      </main>
    )
  }

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
          <p className="label-sm">Administration</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">User logins</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="badge badge-warn">Admin access only</span>
          <span className="badge badge-neutral">
            {users.length} {users.length === 1 ? 'account' : 'accounts'}
          </span>
        </div>
      </div>

      {rowMessage && (
        <div className="mt-4 rounded border border-[var(--color-warn-border)] bg-[var(--color-warn-surface)] px-4 py-2 text-sm text-[var(--color-warn-ink)]">
          {rowMessage}
        </div>
      )}

      <form onSubmit={handleCreate} className="card mt-6 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">New login</h2>
        </div>
        {formError && (
          <p className="mt-2 rounded border border-[var(--color-crit-border)] bg-[var(--color-crit-surface)] px-3 py-2 text-sm text-[var(--color-crit-ink)]">
            {formError}
          </p>
        )}
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          <label className="block text-sm">
            <span className="text-[var(--color-ink-secondary)]">Email</span>
            <input
              required
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="input mt-1 w-full"
            />
          </label>
          <label className="block text-sm">
            <span className="text-[var(--color-ink-secondary)]">Name</span>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input mt-1 w-full"
            />
          </label>
          <label className="block text-sm">
            <span className="text-[var(--color-ink-secondary)]">
              Password ({MIN_PASSWORD_LENGTH}+ chars)
            </span>
            <input
              required
              type="password"
              minLength={MIN_PASSWORD_LENGTH}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="input mt-1 w-full"
            />
          </label>
          <label className="block text-sm">
            <span className="text-[var(--color-ink-secondary)]">Role</span>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as CreateForm['role'] })}
              className="input mt-1 w-full"
            >
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button type="submit" disabled={busy} className="btn-primary">
            Create login
          </button>
          <p className="text-xs text-[var(--color-ink-faint)]">
            Link logins to people on the People page. Resetting a password signs that
            user out everywhere. Accounts are never deleted.
          </p>
        </div>
      </form>

      <table className="table-precision mt-6">
        <thead>
          <tr>
            <th>Email</th>
            <th>Name</th>
            <th>Linked person</th>
            <th>Role</th>
            <th className="num">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td className="font-medium">{u.email}</td>
              <td className="text-[var(--color-ink-secondary)]">{u.name}</td>
              <td className="text-[var(--color-ink-secondary)]">
                {u.personName ?? <span className="text-[var(--color-ink-faint)]">not linked</span>}
              </td>
              <td>
                {u.id === meId ? (
                  <span className={u.role === 'admin' ? 'badge badge-ink' : 'badge badge-neutral'}>
                    {u.role} (you)
                  </span>
                ) : (
                  <select
                    value={u.role}
                    disabled={busy}
                    onChange={(e) => handleRole(u, e.target.value as 'admin' | 'member')}
                    className="input h-8 px-2 py-0 text-xs"
                  >
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                  </select>
                )}
              </td>
              <td className="num">
                <button
                  onClick={() => handleReset(u)}
                  disabled={busy}
                  className="btn-secondary px-2 py-1 text-xs disabled:opacity-50"
                >
                  Reset password
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="card mt-6 border-l-4 border-l-[var(--color-beacon)] p-4">
        <p className="label-sm">Guardrails</p>
        <p className="mt-1 text-sm text-[var(--color-ink-secondary)]">
          You can't change your own role — a second admin must do it. Resetting a
          password signs that user's sessions out everywhere. Accounts are never
          deleted.
        </p>
      </div>
    </main>
  )
}