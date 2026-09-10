import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { getCurrentUserFn, signOutFn } from '../functions/auth'
import {
  getVtoFn,
  updateVtoFn,
  listVtoVersionsFn,
  restoreVtoVersionFn,
} from '../functions/vto'
import {
  listCoreValuesFn,
  createCoreValueFn,
  updateCoreValueFn,
  reorderCoreValuesFn,
} from '../functions/coreValues'
import type { VtoVersionSummary } from '../server/vto'
import type { VtoView } from '../server/vto'
import type { CoreValue } from '../server/schema'

export const Route = createFileRoute('/vto')({
  loader: async () => {
    const [vto, me] = await Promise.all([getVtoFn(), getCurrentUserFn()])
    // Core values: everyone reads the active list (read view); admins also
    // fetch the full list (incl. inactive) for the management panel.
    const activeValues = await listCoreValuesFn()
    const values = activeValues.ok ? activeValues.value : []
    // Version history is admin-only; members just get the live read view.
    let versions: VtoVersionSummary[] = []
    let allValues: CoreValue[] = values
    if (me.ok && me.user.role === 'admin') {
      const full = await listCoreValuesFn({ data: { includeInactive: true } })
      if (full.ok) allValues = full.value
      const history = await listVtoVersionsFn()
      if (history.ok) versions = history.value
    }
    return { vto: vto.ok ? vto.value : null, me: me.ok ? me.user : null, versions, values, allValues }
  },
  component: VtoPage,
})

type VtoForm = Omit<VtoView, 'exists' | 'updatedAt' | 'publishedAt'>

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
  const { exists: _exists, updatedAt: _updatedAt, publishedAt: _publishedAt, ...form } = view
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
  const [versions, setVersions] = useState<VtoVersionSummary[]>(data.versions ?? [])
  const [values, setValues] = useState<CoreValue[]>(data.values ?? [])
  const [allValues, setAllValues] = useState<CoreValue[]>(data.allValues ?? [])

  async function refreshValues() {
    const active = await listCoreValuesFn()
    if (active.ok) setValues(active.value)
    if (isAdmin) {
      const full = await listCoreValuesFn({ data: { includeInactive: true } })
      if (full.ok) setAllValues(full.value)
    }
  }

  async function refreshVersions() {
    const result = await listVtoVersionsFn()
    if (result.ok) setVersions(result.value)
  }

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
    refreshVersions()
  }

  function set<K extends keyof VtoForm>(key: K, value: VtoForm[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  async function handleRestore(versionId: number) {
    if (!confirm('Restore this version? It becomes the published V/TO (and a new version is recorded).'))
      return
    setBusy(true)
    setError(null)
    const result = await restoreVtoVersionFn({ data: { versionId } })
    setBusy(false)
    if (!result.ok) {
      setError(result.error === 'not_found' ? 'That version no longer exists.' : 'Something went wrong.')
      return
    }
    setView(result.value)
    setDraft(toForm(result.value))
    setEditing(false)
    refreshVersions()
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
        <ReadView view={view} values={values} />
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
        <ReadView view={view} values={values} />
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
        <VersionHistory versions={versions} busy={busy} onRestore={handleRestore} />
        <CoreValuesPanel allValues={allValues} busy={busy} onChanged={refreshValues} />
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

function ReadView(props: { view: VtoView; values: CoreValue[] }) {
  const v = props.view
  return (
    <div>
      <div className="mt-4 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Vision/Traction Organizer</h1>
        <span className="text-xs text-slate-400">
          {v.exists
            ? `published as of ${(v.publishedAt ?? v.updatedAt)?.slice(0, 10) ?? '—'}`
            : 'not yet written'}
        </span>
      </div>
      <PageHeading title="Page 1 — Vision" />
      <QuestionBlock title="1 · Core Values">
        {props.values.length === 0 ? (
          <p className="text-sm text-slate-500">No core values set yet.</p>
        ) : (
          <ol className="space-y-1 text-sm text-slate-700">
            {props.values.map((value) => (
              <li key={value.id}>
                <span className="font-medium">{value.name}</span>
                {value.description ? (
                  <span className="text-slate-600"> — {value.description}</span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
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
/** Admin-only version history (ticket 06): newest first, restore per entry. */
/**
 * Admin-only core values management (ticket 07). Rows are never deleted —
 * deactivate flips active off; reactivate brings them back. Reorder sends the
 * complete ordered ID list (including inactive rows).
 */
function CoreValuesPanel(props: {
  allValues: CoreValue[]
  busy: boolean
  onChanged: () => Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')

  const ERROR_TEXT: Record<string, string> = {
    forbidden: 'Only admins can manage core values.',
    name_required: 'Name is required.',
    name_taken: 'A core value with that name already exists (case-insensitive).',
    not_found: 'That core value no longer exists — refresh.',
    invalid_order: 'Reorder failed — refresh and try again.',
    unauthenticated: 'Please sign in.',
  }

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    const result = await action()
    if (!result.ok) {
      setError(ERROR_TEXT[result.error ?? ''] ?? 'Something went wrong.')
      return
    }
    await props.onChanged()
  }

  function move(index: number, delta: number) {
    const next = [...props.allValues]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    run(() => reorderCoreValuesFn({ data: { orderedIds: next.map((v) => v.id) } }))
  }

  return (
    <section className="mt-8 rounded border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Core values</h2>
        <button
          onClick={() => setAdding(!adding)}
          className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
        >
          {adding ? 'Close' : '+ Add value'}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            run(async () => {
              const result = await createCoreValueFn({
                data: { name: newName, description: newDescription },
              })
              if (result.ok) {
                setNewName('')
                setNewDescription('')
                setAdding(false)
              }
              return result
            })
          }}
          className="mt-3 flex gap-2"
        >
          <input
            required
            placeholder="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-40 rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <input
            placeholder="Description (optional)"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <button
            type="submit"
            disabled={props.busy}
            className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Add
          </button>
        </form>
      )}
      <ul className="mt-3 space-y-1">
        {props.allValues.map((value, i) => (
          <li
            key={value.id}
            className="flex items-center gap-2 rounded border border-slate-100 px-2 py-1 text-sm"
          >
            <span className="flex gap-0.5">
              <button
                disabled={i === 0 || props.busy}
                onClick={() => move(i, -1)}
                className="rounded border border-slate-300 px-1.5 py-0.5 text-xs disabled:opacity-30"
                title="Move up"
              >
                ↑
              </button>
              <button
                disabled={i === props.allValues.length - 1 || props.busy}
                onClick={() => move(i, 1)}
                className="rounded border border-slate-300 px-1.5 py-0.5 text-xs disabled:opacity-30"
                title="Move down"
              >
                ↓
              </button>
            </span>
            {editingId === value.id ? (
              <span className="flex flex-1 items-center gap-2">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-40 rounded border border-slate-300 px-2 py-1 text-sm"
                />
                <input
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                />
                <button
                  onClick={() =>
                    run(async () => {
                      const result = await updateCoreValueFn({
                        data: { id: value.id, name: editName, description: editDescription },
                      })
                      if (result.ok) setEditingId(null)
                      return result
                    })
                  }
                  className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <span className="flex flex-1 items-center gap-2">
                <span className={value.active ? 'font-medium' : 'font-medium text-slate-400'}>
                  {value.name}
                </span>
                {value.description ? (
                  <span className="text-slate-600"> — {value.description}</span>
                ) : null}
                {!value.active && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">
                    inactive
                  </span>
                )}
              </span>
            )}
            {editingId !== value.id && (
              <span className="flex gap-1 text-xs">
                <button
                  onClick={() => {
                    setEditingId(value.id)
                    setEditName(value.name)
                    setEditDescription(value.description ?? '')
                  }}
                  className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-100"
                >
                  Edit
                </button>
                {value.active ? (
                  <button
                    onClick={() =>
                      run(() =>
                        updateCoreValueFn({ data: { id: value.id, active: false } }),
                      )
                    }
                    className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-100"
                  >
                    Deactivate
                  </button>
                ) : (
                  <button
                    onClick={() =>
                      run(() => updateCoreValueFn({ data: { id: value.id, active: true } }))
                    }
                    className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-100"
                  >
                    Reactivate
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
        {props.allValues.length === 0 && (
          <li className="py-2 text-center text-sm text-slate-400">No core values yet.</li>
        )}
      </ul>
    </section>
  )
}

function VersionHistory(props: {
  versions: VtoVersionSummary[]
  busy: boolean
  onRestore: (versionId: number) => void
}) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium text-slate-500">Version history</h2>
      {props.versions.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">No versions yet — save the V/TO once.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {props.versions.map((v, i) => (
            <li
              key={v.id}
              className="flex items-center justify-between rounded border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <span>
                <span className="font-medium">#{props.versions.length - i}</span>{' '}
                <span className="text-slate-600">
                  {v.publishedAt.slice(0, 19).replace('T', ' ')}
                </span>{' '}
                <span className="text-slate-400">by {v.authorEmail}</span>
                {i === 0 && (
                  <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700">
                    current
                  </span>
                )}
              </span>
              {i !== 0 && (
                <button
                  disabled={props.busy}
                  onClick={() => props.onRestore(v.id)}
                  className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-50"
                >
                  Restore
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
