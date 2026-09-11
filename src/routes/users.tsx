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
        <p className="mt-8 text-sm text-slate-600">Only admins can manage users.</p>
      </main>
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

      <h1 className="mt-6 text-xl font-semibold">User logins</h1>

      {rowMessage && <p className="mt-2 text-sm text-amber-700">{rowMessage}</p>}

      <form
        onSubmit={handleCreate}
        className="mt-4 space-y-3 rounded border border-slate-200 bg-white p-4 shadow-sm"
      >
        <h2 className="font-medium">New login</h2>
        {formError && <p className="text-sm text-red-600">{formError}</p>}
        <div className="grid grid-cols-4 gap-3">
          <label className="block text-sm">
            <span className="text-slate-700">Email</span>
            <input
              required
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-700">Name</span>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-700">
              Password ({MIN_PASSWORD_LENGTH}+ chars)
            </span>
            <input
              required
              type="password"
              minLength={MIN_PASSWORD_LENGTH}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-700">Role</span>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as CreateForm['role'] })}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            >
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
          </label>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Create login
        </button>
        <p className="text-xs text-slate-400">
          Link logins to people on the People page. Resetting a password signs that
          user out everywhere. Accounts are never deleted.
        </p>
      </form>

      <table className="mt-6 w-full rounded border border-slate-200 bg-white text-sm shadow-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="px-4 py-2 font-medium">Email</th>
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Linked person</th>
            <th className="px-4 py-2 font-medium">Role</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-2 font-medium">{u.email}</td>
              <td className="px-4 py-2 text-slate-600">{u.name}</td>
              <td className="px-4 py-2 text-slate-600">
                {u.personName ?? <span className="text-slate-400">not linked</span>}
              </td>
              <td className="px-4 py-2">
                {u.id === meId ? (
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                    {u.role} (you)
                  </span>
                ) : (
                  <select
                    value={u.role}
                    disabled={busy}
                    onChange={(e) => handleRole(u, e.target.value as 'admin' | 'member')}
                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                  >
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                  </select>
                )}
              </td>
              <td className="px-4 py-2 text-right">
                <button
                  onClick={() => handleReset(u)}
                  disabled={busy}
                  className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-50"
                >
                  Reset password
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}