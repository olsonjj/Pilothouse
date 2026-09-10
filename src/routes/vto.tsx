import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { getCurrentUserFn, signOutFn } from '../functions/auth'
import { getVtoFn, updateVtoFn } from '../functions/vto'
import type { VtoView } from '../server/vto'

export const Route = createFileRoute('/vto')({
  loader: async () => {
    const [vto, me] = await Promise.all([getVtoFn(), getCurrentUserFn()])
    return { vto: vto.ok ? vto.value : null, me: me.ok ? me.user : null }
  },
  component: VtoPage,
})

type VtoForm = Omit<VtoView, 'exists' | 'updatedAt'>

const EMPTY_FORM: VtoForm = {
  coreFocusWhy: '',
  coreFocusWhat: '',
  tenYearTarget: '',
  tenYearTargetDate: null,
  marketingTargetMarket: '',
  marketingThreeUniques: [],
  marketingProvenProcess: '',
  marketingGuarantee: '',
  threeYearDate: null,
  threeYearRevenue: null,
  threeYearProfit: null,
  threeYearItems: [],
  oneYearLabel: '',
  oneYearRevenue: null,
  oneYearProfit: null,
  oneYearItems: [],
  oneYearPriorities: [],
}

function toForm(view: VtoView): VtoForm {
  const { exists: _exists, updatedAt: _updatedAt, ...form } = view
  return form
}

const ERROR_TEXT: Record<string, string> = {
  forbidden: 'Only admins can edit the V/TO.',
  missing_required: 'Core Focus ("why" and "what") is required.',
  invalid_list: 'List items must be short text (and at most three uniques).',
  invalid_number: 'Financial figures must be non-negative whole numbers.',
  invalid_date: 'Dates must be valid (YYYY-MM-DD).',
  unauthenticated: 'Please sign in.',
}

/** Ordered-list editor: one input per item with add/remove/reorder buttons. */
function ListEditor(props: {
  label: string
  items: string[]
  onChange: (items: string[]) => void
}) {
  function move(index: number, delta: number) {
    const next = [...props.items]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    props.onChange(next)
  }
  return (
    <div>
      <span className="text-sm text-slate-700">{props.label}</span>
      <div className="mt-1 space-y-1">
        {props.items.map((item, i) => (
          <div key={i} className="flex items-center gap-1">
            <input
              value={item}
              onChange={(e) => {
                const updated = [...props.items]
                updated[i] = e.target.value
                props.onChange(updated)
              }}
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
            <button
              type="button"
              disabled={i === 0}
              onClick={() => move(i, -1)}
              className="rounded border border-slate-300 px-1.5 py-1 text-xs disabled:opacity-30"
              title="Move up"
            >
              ↑
            </button>
            <button
              type="button"
              disabled={i === props.items.length - 1}
              onClick={() => move(i, 1)}
              className="rounded border border-slate-300 px-1.5 py-1 text-xs disabled:opacity-30"
              title="Move down"
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => props.onChange(props.items.filter((_, j) => j !== i))}
              className="rounded border border-slate-300 px-1.5 py-1 text-xs hover:bg-slate-100"
              title="Remove"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => props.onChange([...props.items, ''])}
        className="mt-1 rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100"
      >
        + Add
      </button>
    </div>
  )
}

function MoneyField(props: {
  label: string
  value: number | null
  onChange: (value: number | null) => void
}) {
  return (
    <label className="block text-sm">
      <span className="text-slate-700">{props.label}</span>
      <input
        type="number"
        min={0}
        step={1}
        value={props.value ?? ''}
        onChange={(e) =>
          props.onChange(e.target.value === '' ? null : Number(e.target.value))
        }
        className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
      />
    </label>
  )
}

function DateField(props: {
  label: string
  value: string | null
  onChange: (value: string | null) => void
}) {
  return (
    <label className="block text-sm">
      <span className="text-slate-700">{props.label}</span>
      <input
        type="date"
        value={props.value ?? ''}
        onChange={(e) => props.onChange(e.target.value === '' ? null : e.target.value)}
        className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
      />
    </label>
  )
}

function TextField(props: {
  label: string
  value: string
  onChange: (value: string) => void
  textarea?: boolean
}) {
  return (
    <label className="block text-sm">
      <span className="text-slate-700">{props.label}</span>
      {props.textarea ? (
        <textarea
          rows={3}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
        />
      ) : (
        <input
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
        />
      )}
    </label>
  )
}

function PageHeading(props: { title: string }) {
  return (
    <h2 className="mt-8 border-b border-slate-200 pb-1 text-lg font-semibold text-slate-700">
      {props.title}
    </h2>
  )
}

function QuestionBlock(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 rounded border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        {props.title}
      </h3>
      <div className="mt-2">{props.children}</div>
    </section>
  )
}

function StringList(props: { items: string[] }) {
  if (props.items.length === 0) return <p className="text-sm text-slate-400">—</p>
  return (
    <ol className="list-decimal space-y-0.5 pl-5 text-sm text-slate-700">
      {props.items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ol>
  )
}

function VtoPage() {
  const navigate = useNavigate()
  const data = Route.useLoaderData()
  const isAdmin = data.me?.role === 'admin'
  const initial = data.vto

  const [view, setView] = useState<VtoView | null>(data.vto)
  const [draft, setDraft] = useState<VtoForm>(initial ? toForm(initial) : EMPTY_FORM)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSignOut() {
    await signOutFn()
    await navigate({ to: '/signin' })
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const result = await updateVtoFn({ data: draft })
    setBusy(false)
    if (!result.ok) {
      setError(ERROR_TEXT[result.error] ?? 'Something went wrong.')
      return
    }
    setView(result.value)
    setDraft(toForm(result.value))
    setEditing(false)
  }

  function set<K extends keyof VtoForm>(key: K, value: VtoForm[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  if (!view) return <p className="p-8 text-sm text-slate-500">Loading…</p>

  if (!isAdmin) {
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
        <ReadView view={view} />
      </main>
    )
  }

  if (!editing) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <header className="flex items-center justify-between">
          <Link to="/" className="text-sm text-blue-600 hover:underline">
            ← Home
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSignOut}
              className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
            >
              Sign out
            </button>
          </div>
        </header>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <ReadView view={view} />
        <div className="mt-6">
          <button
            onClick={() => {
              setDraft(toForm(view))
              setEditing(true)
            }}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
          >
            Edit V/TO
          </button>
        </div>
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
      <h1 className="mt-4 text-xl font-semibold">Vision/Traction Organizer</h1>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <form onSubmit={handleSave} className="space-y-4 pb-16">
        <QuestionBlock title="2 · Core Focus">
          <div className="space-y-2">
            <TextField
              label="Why we exist (required)"
              value={draft.coreFocusWhy}
              onChange={(v) => set('coreFocusWhy', v)}
              textarea
            />
            <TextField
              label="What we do (required)"
              value={draft.coreFocusWhat}
              onChange={(v) => set('coreFocusWhat', v)}
              textarea
            />
          </div>
        </QuestionBlock>
        <QuestionBlock title="3 · 10-Year Target">
          <div className="space-y-2">
            <TextField
              label="Target"
              value={draft.tenYearTarget}
              onChange={(v) => set('tenYearTarget', v)}
              textarea
            />
            <DateField
              label="Target date (optional)"
              value={draft.tenYearTargetDate}
              onChange={(v) => set('tenYearTargetDate', v)}
            />
          </div>
        </QuestionBlock>
        <QuestionBlock title="4 · Marketing Strategy">
          <div className="space-y-2">
            <TextField
              label="Target market"
              value={draft.marketingTargetMarket}
              onChange={(v) => set('marketingTargetMarket', v)}
            />
            <ListEditor
              label="Three uniques"
              items={draft.marketingThreeUniques}
              onChange={(items) => set('marketingThreeUniques', items)}
            />
            <TextField
              label="Proven process"
              value={draft.marketingProvenProcess}
              onChange={(v) => set('marketingProvenProcess', v)}
              textarea
            />
            <TextField
              label="Guarantee"
              value={draft.marketingGuarantee}
              onChange={(v) => set('marketingGuarantee', v)}
            />
          </div>
        </QuestionBlock>
        <QuestionBlock title="5 · 3-Year Picture">
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-3">
              <DateField
                label="Date"
                value={draft.threeYearDate}
                onChange={(v) => set('threeYearDate', v)}
              />
              <MoneyField
                label="Revenue target"
                value={draft.threeYearRevenue}
                onChange={(v) => set('threeYearRevenue', v)}
              />
              <MoneyField
                label="Profit target"
                value={draft.threeYearProfit}
                onChange={(v) => set('threeYearProfit', v)}
              />
            </div>
            <ListEditor
              label="Looks like"
              items={draft.threeYearItems}
              onChange={(items) => set('threeYearItems', items)}
            />
          </div>
        </QuestionBlock>
        <QuestionBlock title="6 · 1-Year Plan">
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-3">
              <label className="block text-sm">
                <span className="text-slate-700">Year</span>
                <input
                  value={draft.oneYearLabel}
                  onChange={(e) => set('oneYearLabel', e.target.value)}
                  placeholder="e.g. 2027"
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                />
              </label>
              <MoneyField
                label="Revenue target"
                value={draft.oneYearRevenue}
                onChange={(v) => set('oneYearRevenue', v)}
              />
              <MoneyField
                label="Profit target"
                value={draft.oneYearProfit}
                onChange={(v) => set('oneYearProfit', v)}
              />
            </div>
            <ListEditor
              label="Looks like"
              items={draft.oneYearItems}
              onChange={(items) => set('oneYearItems', items)}
            />
            <ListEditor
              label="1-Year priorities"
              items={draft.oneYearPriorities}
              onChange={(items) => set('oneYearPriorities', items)}
            />
          </div>
        </QuestionBlock>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Save V/TO
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false)
              setError(null)
            }}
            className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100"
          >
            Cancel
          </button>
        </div>
      </form>
    </main>
  )
}

function ReadView(props: { view: VtoView }) {
  const v = props.view
  return (
    <div>
      <div className="mt-4 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Vision/Traction Organizer</h1>
        <span className="text-xs text-slate-400">
          {v.exists ? `as of ${v.updatedAt?.slice(0, 10)}` : 'not yet written'}
        </span>
      </div>
      <PageHeading title="Page 1 — Vision" />
      <QuestionBlock title="1 · Core Values">
        <p className="text-sm text-slate-500">
          Managed as their own list (arrives with the People Analyzer work).
        </p>
      </QuestionBlock>
      <QuestionBlock title="2 · Core Focus">
        <div className="space-y-1 text-sm text-slate-700">
          <p className="whitespace-pre-wrap">{v.coreFocusWhy || '—'}</p>
          <p className="whitespace-pre-wrap font-medium">{v.coreFocusWhat || '—'}</p>
        </div>
      </QuestionBlock>
      <QuestionBlock title="3 · 10-Year Target">
        <p className="whitespace-pre-wrap text-sm text-slate-700">
          {v.tenYearTarget || '—'}
          {v.tenYearTargetDate ? ` (by ${v.tenYearTargetDate})` : ''}
        </p>
      </QuestionBlock>
      <PageHeading title="Page 2 — Strategy & Plan" />
      <QuestionBlock title="4 · Marketing Strategy">
        <dl className="space-y-1 text-sm text-slate-700">
          <div>
            <dt className="font-medium text-slate-500">Target market</dt>
            <dd>{v.marketingTargetMarket || '—'}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Three uniques</dt>
            <dd>
              <StringList items={v.marketingThreeUniques} />
            </dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Proven process</dt>
            <dd className="whitespace-pre-wrap">{v.marketingProvenProcess || '—'}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Guarantee</dt>
            <dd className="whitespace-pre-wrap">{v.marketingGuarantee || '—'}</dd>
          </div>
        </dl>
      </QuestionBlock>
      <QuestionBlock title="5 · 3-Year Picture">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <span className="text-slate-500">Date</span>
            <p className="text-slate-700">{v.threeYearDate ?? '—'}</p>
          </div>
          <div>
            <span className="text-slate-500">Revenue</span>
            <p className="text-slate-700">{v.threeYearRevenue ?? '—'}</p>
          </div>
          <div>
            <span className="text-slate-500">Profit</span>
            <p className="text-slate-700">{v.threeYearProfit ?? '—'}</p>
          </div>
        </div>
        <div className="mt-2">
          <span className="text-sm font-medium text-slate-500">Looks like</span>
          <StringList items={v.threeYearItems} />
        </div>
      </QuestionBlock>
      <QuestionBlock title="6/7 · 1-Year Plan (incl. profit/metrics)">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <span className="text-slate-500">Year</span>
            <p className="text-slate-700">{v.oneYearLabel || '—'}</p>
          </div>
          <div>
            <span className="text-slate-500">Revenue</span>
            <p className="text-slate-700">{v.oneYearRevenue ?? '—'}</p>
          </div>
          <div>
            <span className="text-slate-500">Profit</span>
            <p className="text-slate-700">{v.oneYearProfit ?? '—'}</p>
          </div>
        </div>
        <div className="mt-2">
          <span className="text-sm font-medium text-slate-500">Looks like</span>
          <StringList items={v.oneYearItems} />
        </div>
        <div className="mt-2">
          <span className="text-sm font-medium text-slate-500">Priorities</span>
          <StringList items={v.oneYearPriorities} />
        </div>
      </QuestionBlock>
      <QuestionBlock title="8 · Issues List">
        <p className="text-sm text-slate-500">
          Tracked by the Issues module (link lands when that module ships).
        </p>
      </QuestionBlock>
    </div>
  )
}