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
    const done = todo.status === 'done'
    const dropped = todo.status === 'dropped'
    const settled = done || dropped
    return (
      <li
        className={
          'flex items-start justify-between gap-3 rounded border px-3 py-2.5 text-sm transition-colors ' +
          (overdue
            ? 'border-crit-border bg-crit-surface'
            : 'border-line bg-white hover:bg-canvas') +
          (settled ? ' opacity-75' : '')
        }
      >
        <span className="flex min-w-0 items-start gap-2.5">
          <span
            aria-hidden
            className={
              'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border-[1.5px] text-[10px] leading-none ' +
              (done ? 'border-navy bg-navy text-white' : 'border-ruler bg-white')
            }
          >
            {done ? '✓' : ''}
          </span>
          <span className="min-w-0">
            <span
              className={
                'font-medium ' +
                (overdue ? 'text-crit-ink' : settled ? 'text-ink-secondary line-through' : 'text-ink')
              }
            >
              {todo.title}
            </span>{' '}
            {overdue && (
              <span className="badge badge-crit ml-1 align-middle">Overdue · due {todo.dueDate}</span>
            )}
            <span className="tnum mt-0.5 block font-mono text-xs text-ink-muted">
              {todo.assigneeName} · due {todo.dueDate}
            </span>
            {dropped && todo.dropReason && (
              <span className="mt-0.5 block text-xs text-ink-faint">
                dropped: {todo.dropReason}
              </span>
            )}
          </span>
        </span>
        {todo.status === 'open' ? (
          <span className="flex shrink-0 gap-1">
            <button
              disabled={busy}
              onClick={() => run(() => completeTodoFn({ data: { todoId: todo.id } }))}
              className="rounded border border-ruler bg-white px-2 py-1 text-xs text-ink hover:bg-panel disabled:opacity-50"
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
              className="btn-ghost rounded px-2 py-1 text-xs"
            >
              Drop
            </button>
          </span>
        ) : (
          <span
            className={
              'badge shrink-0 ' + (done ? 'badge-ok' : 'badge-neutral')
            }
          >
            {done ? 'done' : 'dropped'}
          </span>
        )}
      </li>
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
          <p className="label-sm">7-day accountability</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">To-Dos</h1>
          <p className="tnum mt-1 font-mono text-xs text-ink-muted">
            {open.length} open · {mine.filter((t) => t.status === 'open' && t.dueDate < today).length}{' '}
            overdue (mine)
          </p>
        </div>
        {error && (
          <p className="rounded border border-crit-border bg-crit-surface px-3 py-2 text-sm text-crit-ink">
            {error}
          </p>
        )}
      </div>

      <form
        onSubmit={handleAdd}
        className="card mt-4 flex flex-wrap items-end gap-2 p-3"
      >
        <label className="min-w-48 flex-1 text-sm">
          <span className="label-sm">New to-do</span>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="One line — if it needs a paragraph, it's an issue"
            className="input mt-1 w-full"
          />
        </label>
        <label className="text-sm">
          <span className="label-sm">Assign to</span>
          <select
            required
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className="input mt-1 block"
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
          title="Due date is set automatically to 7 days from today"
          className="btn-primary disabled:opacity-50"
        >
          + Add to-do
        </button>
      </form>

      <div className="mt-6 grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <span className="inline-block h-2 w-2 rounded-full bg-ok-dot" aria-hidden />
              My to-dos
            </h2>
            <span className="badge badge-neutral">{mine.length} items</span>
          </div>
          {mine.length === 0 ? (
            <p className="mt-3 text-sm text-ink-faint">Nothing assigned to you.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {mine.map((todo) => (
                <TodoRow key={todo.id} todo={todo} />
              ))}
            </ul>
          )}
        </section>

        <section className="card p-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <span className="inline-block h-2 w-2 rounded-full bg-crit-dot" aria-hidden />
              All open (team)
            </h2>
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
              className="btn-secondary rounded px-2 py-1 text-xs"
            >
              {showTeam ? 'Hide weekly view & rates' : 'Weekly view & rates'}
            </button>
          </div>
          {open.length === 0 ? (
            <p className="mt-3 text-sm text-ink-faint">No open to-dos.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {open.map((todo) => (
                <TodoRow key={todo.id} todo={todo} />
              ))}
            </ul>
          )}
        </section>
      </div>

      {showTeam && (
        <>
          <section className="mt-8">
            <h2 className="label-sm">Team by week</h2>
            {byWeek.length === 0 ? (
              <p className="mt-2 text-sm text-ink-faint">Nothing yet.</p>
            ) : (
              <div className="mt-3 grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
                {byWeek.map((bucket) => (
                  <div key={bucket.weekMonday} className="card p-4">
                    <h3 className="flex items-center justify-between">
                      <span className="tnum font-mono text-sm font-semibold text-ink">
                        {bucket.label}
                      </span>
                      <span className="badge badge-neutral">{bucket.todos.length} to-dos</span>
                    </h3>
                    <ul className="mt-3 space-y-2">
                      {bucket.todos.map((todo) => (
                        <TodoRow key={todo.id} todo={todo} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-2 text-xs text-ink-faint">
              Weeks are derived from due dates (Monday-start); dropped to-dos show their reason.
            </p>
          </section>

          <section className="mt-8">
            <h2 className="label-sm">Completion — last 4 full weeks</h2>
            {rates && (
              <table className="table-precision mt-3">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th className="num">Done</th>
                    <th className="num">Counted</th>
                    <th className="num">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {rates.people.map((p) => (
                    <tr key={p.personId}>
                      <td>{p.personName}</td>
                      <td className="num text-ink-secondary">{p.done}</td>
                      <td className="num text-ink-secondary">{p.counted}</td>
                      <td className="num text-ink-secondary">
                        {p.rate == null ? '—' : `${p.rate}%`}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-canvas font-semibold">
                    <td>Team</td>
                    <td className="num">{rates.team.done}</td>
                    <td className="num">{rates.team.counted}</td>
                    <td className="num">{rates.team.rate == null ? '—' : `${rates.team.rate}%`}</td>
                  </tr>
                </tbody>
              </table>
            )}
            {rates && (
              <p className="tnum mt-2 font-mono text-xs text-ink-faint">
                Window {rates.windowStart} – {rates.windowEnd} (the 4 fully-elapsed weeks before this
                one). Dropped to-dos are excluded — the rate stays honest.
              </p>
            )}
          </section>
        </>
      )}
    </main>
  )
}