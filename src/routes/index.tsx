import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { getCurrentUserFn, signOutFn } from '../functions/auth'
import { getCurrentPeriodFn } from '../functions/quarters'

export const Route = createFileRoute('/')({
  // Root guard already redirected unauthenticated visitors; loader refreshes the user.
  loader: async () => {
    const [me, period] = await Promise.all([getCurrentUserFn(), getCurrentPeriodFn()])
    return { me, period }
  },
  component: Home,
})

const SECTIONS: Array<{ to: string; title: string; blurb: string; search?: { seat: null } }> = [
  {
    to: '/org-chart',
    search: { seat: null },
    title: 'Org Chart',
    blurb: 'Seats, reporting lines, and Right Fit ratings for every role.',
  },
  {
    to: '/people',
    title: 'People',
    blurb: 'The roster — profiles, start dates, and linked accounts.',
  },
  {
    to: '/todos',
    title: 'To-Dos',
    blurb: 'This week’s action items. Overdue sorts first.',
  },
  {
    to: '/data',
    title: 'Data',
    blurb: 'Weekly metrics against target — the company pulse.',
  },
  {
    to: '/goals',
    title: 'Goals',
    blurb: 'Quarterly priorities with weekly on/off-track status.',
  },
  {
    to: '/issues',
    title: 'Issues',
    blurb: 'Short-term and long-term issues, solved or carried.',
  },
  {
    to: '/company',
    title: 'Company',
    blurb: 'Core values, core focus, and the multi-year plan.',
  },
  {
    to: '/users',
    title: 'Users',
    blurb: 'Accounts, roles, and password resets. Admin only.',
  },
]

function Home() {
  const navigate = useNavigate()
  const data = Route.useLoaderData()
  const user = data.me.ok ? data.me.user : null
  if (!user) return null

  const quarterLabel = data.period.ok ? data.period.value.quarter?.label ?? null : null
  const weekLabel = data.period.ok ? data.period.value.weekLabel : null

  async function handleSignOut() {
    await signOutFn()
    await navigate({ to: '/signin' })
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-10">
      {/* Brand row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/pilothouse-logo.png" alt="Pilothouse" className="h-8 w-auto" />
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-ink-muted sm:inline">
            {user.name} · {user.email}
          </span>
          <span className="badge-neutral">{user.role}</span>
          <button onClick={handleSignOut} className="btn-ghost">
            Sign out
          </button>
        </div>
      </div>

      {/* Instrument status strip: operating cadence */}
      <section className="card mt-8 grid grid-cols-1 divide-y divide-[#e2e8f0] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="p-4">
          <div className="label-sm">Current quarter</div>
          <div className="tnum mt-1 font-mono text-xl font-semibold text-navy">
            {quarterLabel ?? '—'}
          </div>
          {!quarterLabel && <div className="mt-1 text-sm text-ink-muted">No quarter seeded</div>}
        </div>
        <div className="p-4">
          <div className="label-sm">Current week</div>
          <div className="tnum mt-1 font-mono text-xl font-semibold text-navy">
            {weekLabel ?? '—'}
          </div>
        </div>
        <div className="p-4">
          <div className="label-sm">Cadence</div>
          <div className="mt-1 flex items-center gap-2 text-sm text-ink">
            <span className="badge-warn">Monday rhythm</span>
            <span className="text-ink-muted">Weekly leadership review</span>
          </div>
        </div>
      </section>

      {/* Module grid */}
      <nav className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Sections">
        <Link
          to="/meeting"
          className="card-raised group flex flex-col justify-between rounded-lg bg-navy p-5 text-white transition hover:-translate-y-0.5 hover:shadow-lg"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.04em] text-slate-300">
                Weekly Meeting
              </span>
              <span className="badge-ok">Live cadence</span>
            </div>
            <p className="mt-2 text-sm leading-5 text-slate-300">
              Run the timed agenda — numbers, goals, to-dos, and the issue list.
            </p>
          </div>
          <span className="mt-4 text-sm font-medium text-white">
            Open <span aria-hidden>→</span>
          </span>
        </Link>

        {SECTIONS.map((s) => (
          <Link
            key={s.to}
            to={s.to}
            search={s.search}
            className="card group flex flex-col justify-between rounded-lg p-5 transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <div>
              <span className="label-sm">{s.title}</span>
              <p className="mt-2 text-sm leading-5 text-ink-muted">{s.blurb}</p>
            </div>
            <span className="mt-4 text-sm font-medium text-beacon opacity-80 group-hover:opacity-100">
              Open <span aria-hidden>→</span>
            </span>
          </Link>
        ))}
      </nav>

      <p className="mt-10 text-center text-xs text-ink-muted">Private single-company workspace</p>
    </main>
  )
}