import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { getCurrentUserFn, signOutFn } from '../functions/auth'
import { listPeopleFn } from '../functions/people'
import {
  listMyTodosFn,
  listOpenTodosFn,
  listTodosByWeekFn,
  completionRatesFn,
  createTodoFn,
  completeTodoFn,
  dropTodoFn,
} from '../functions/todos'
import type { TodoView, WeekBucket, CompletionRates } from '../server/todos'

export const Route = createFileRoute('/todos')({
  loader: async () => {
    const [me, people] = await Promise.all([getCurrentUserFn(), listPeopleFn()])
    return { me, people: people.ok ? people.value : [] }
  },
  component: TodosPage,
})

function errorText(error: string): string {
  if (error === 'unauthenticated') return 'Sign in first.'
  if (error === 'title_required') return 'A to-do needs a title.'
  if (error === 'assignee_not_found') return 'That assignee no longer exists — refresh.'
  if (error === 'invalid_state') return 'That to-do is no longer open.'
  if (error === 'not_found') return 'That to-do no longer exists — refresh.'
  if (error === 'forbidden') return 'Link your account to a person before creating to-dos.'
  return 'Something went wrong.'
}

function TodosPage() {
  const navigate = useNavigate()
  const data = Route.useLoaderData()
  const people = data.people

  const [mine, setMine] = useState<TodoView[]>([])
  const [open, setOpen] = useState<TodoView[]>([])
  const [byWeek, setByWeek] = useState<WeekBucket[]>([])
  const [rates, setRates] = useState<CompletionRates | null>(null)
  const [showTeam, setShowTeam] = useState(false)
  const [title, setTitle] = useState('')
  const [assigneeId, setAssigneeId] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const today = new Date().toISOString().slice(0, 10)

  async function refresh() {
    const [mineResult, openResult] = await Promise.all([listMyTodosFn(), listOpenTodosFn()])
    if (mineResult.ok) setMine(mineResult.value)
    if (openResult.ok) setOpen(openResult.value)
    if (showTeam) {
      const [weekResult, ratesResult] = await Promise.all([
        listTodosByWeekFn(),
        completionRatesFn(),
      ])
      if (weekResult.ok) setByWeek(weekResult.value)
      if (ratesResult.ok) setRates(ratesResult.value)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true)
    setError(null)
    const result = await action()
    setBusy(false)
    if (!result.ok) {
      setError(errorText(result.error ?? ''))
      return
    }
    await refresh()
  }

  async function handleSignOut() {
    await signOutFn()
    await navigate({ to: '/signin' })
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    await run(async () => {
      const result = await createTodoFn({ data: { title, assigneePersonId: Number(assigneeId) } })
      if (result.ok) setTitle('')
      return result
    })
  }

  function TodoRow(props: { todo: TodoView }) {
    const todo = props.todo
    const overdue = todo.status === 'open' && todo.dueDate < today
    return (
      <li
        className={
          'flex items-center justify-between gap-3 rounded border px-3 py-2 text-sm ' +
          (overdue ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white')
        }
      >
        <span>
          <span className={'font-medium' + (overdue ? ' text-red-700' : '')}>{todo.title}</span>{' '}
          <span className="text-slate-500">
            · {todo.assigneeName} · due {todo.dueDate}
            {overdue ? ' (overdue)' : ''}
          </span>
          {todo.status === 'dropped' && todo.dropReason && (
            <span className="text-slate-400"> · dropped: {todo.dropReason}</span>
          )}
        </span>
        {todo.status === 'open' ? (
          <span className="flex gap-1 text-xs">
            <button
              disabled={busy}
              onClick={() => run(() => completeTodoFn({ data: { todoId: todo.id } }))}
              className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
            >
              Done
            </button>
            <button
              disabled={busy}
              onClick={() => {
                const reason = window.prompt('Why is this being dropped? (required)')
                if (reason && reason.trim()) {
                  run(() => dropTodoFn({ data: { todoId: todo.id, reason } }))
                } else if (reason !== null) {
                  setError('A dropped to-do needs a one-line reason.')
                }
              }}
              className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
            >
              Drop
            </button>
          </span>
        ) : (
          <span className="text-xs text-slate-400">
            {todo.status === 'done' ? 'done' : 'dropped'}
          </span>
        )}
      </li>
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

      <h1 className="mt-6 text-xl font-semibold">To-Dos</h1>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <form onSubmit={handleAdd} className="mt-4 flex items-end gap-2">
        <label className="flex-1 text-sm">
          <span className="text-slate-700">New to-do</span>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="One line — if it needs a paragraph, it's an issue"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="text-slate-700">Assign to</span>
          <select
            required
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className="mt-1 block rounded border border-slate-300 px-3 py-2"
          >
            <option value="">Choose…</option>
            {people.map((p) => (
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
          Add
        </button>
      </form>

      <section className="mt-6">
        <h2 className="text-sm font-medium text-slate-700">My to-dos</h2>
        {mine.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">Nothing assigned to you.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {mine.map((todo) => (
              <TodoRow key={todo.id} todo={todo} />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-700">All open (team)</h2>
          <button
            onClick={async () => {
              const next = !showTeam
              setShowTeam(next)
              if (next) {
                const [weekResult, ratesResult] = await Promise.all([
                  listTodosByWeekFn(),
                  completionRatesFn(),
                ])
                if (weekResult.ok) setByWeek(weekResult.value)
                if (ratesResult.ok) setRates(ratesResult.value)
              }
            }}
            className="text-xs text-blue-600 hover:underline"
          >
            {showTeam ? 'Hide weekly view & rates' : 'Weekly view & rates'}
          </button>
        </div>
        {open.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">No open to-dos.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {open.map((todo) => (
              <TodoRow key={todo.id} todo={todo} />
            ))}
          </ul>
        )}
      </section>

      {showTeam && (
        <>
          <section className="mt-8">
            <h2 className="text-sm font-medium text-slate-700">Team by week</h2>
            {byWeek.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400">Nothing yet.</p>
            ) : (
              byWeek.map((bucket) => (
                <div key={bucket.weekMonday} className="mt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {bucket.label}
                  </h3>
                  <ul className="mt-2 space-y-2">
                    {bucket.todos.map((todo) => (
                      <TodoRow key={todo.id} todo={todo} />
                    ))}
                  </ul>
                </div>
              ))
            )}
            <p className="mt-2 text-xs text-slate-400">
              Weeks are derived from due dates (Monday-start); dropped to-dos show their reason.
            </p>
          </section>

          <section className="mt-8">
            <h2 className="text-sm font-medium text-slate-700">Completion (last 4 full weeks)</h2>
            {rates && (
              <table className="mt-2 w-full rounded border border-slate-200 bg-white text-sm shadow-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="px-3 py-2 font-medium">Person</th>
                    <th className="px-3 py-2 font-medium">Done</th>
                    <th className="px-3 py-2 font-medium">Counted</th>
                    <th className="px-3 py-2 font-medium">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {rates.people.map((p) => (
                    <tr key={p.personId} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2">{p.personName}</td>
                      <td className="px-3 py-2 text-slate-600">{p.done}</td>
                      <td className="px-3 py-2 text-slate-600">{p.counted}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {p.rate == null ? '—' : `${p.rate}%`}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-medium">
                    <td className="px-3 py-2">Team</td>
                    <td className="px-3 py-2">{rates.team.done}</td>
                    <td className="px-3 py-2">{rates.team.counted}</td>
                    <td className="px-3 py-2">
                      {rates.team.rate == null ? '—' : `${rates.team.rate}%`}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
            {rates && (
              <p className="mt-2 text-xs text-slate-400">
                Window {rates.windowStart} – {rates.windowEnd} (the 4 fully-elapsed weeks before
                this one). Dropped to-dos are excluded — the rate stays honest.
              </p>
            )}
          </section>
        </>
      )}
    </main>
  )
}