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

function Home() {
  const navigate = useNavigate()
  const data = Route.useLoaderData()
  const user = data.me.ok ? data.me.user : null
  if (!user) return null

  async function handleSignOut() {
    await signOutFn()
    await navigate({ to: '/signin' })
  }

  return (
    <main className="mx-auto max-w-xl p-8">
      <div className="rounded border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">OpenEOS</h1>
        <p className="mt-4">
          Signed in as <strong>{user.name}</strong>{' '}
          <span className="rounded bg-slate-100 px-2 py-0.5 text-sm text-slate-700">
            {user.role}
          </span>
        </p>
        <p className="mt-1 text-sm text-slate-500">{user.email}</p>
        <p className="mt-1 text-sm text-slate-500">
          {data.period.ok && data.period.value.quarter
            ? `${data.period.value.quarter.label} · ${data.period.value.weekLabel}`
            : 'No current quarter'}
        </p>
        <nav className="mt-6 flex gap-4 text-sm">
          <Link to="/people" className="text-blue-600 hover:underline">
            People
          </Link>
          <Link to="/chart" search={{ seat: null }} className="text-blue-600 hover:underline">
            Chart
          </Link>
        </nav>
        <button
          onClick={handleSignOut}
          className="mt-6 rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100"
        >
          Sign out
        </button>
      </div>
    </main>
  )
}