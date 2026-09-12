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

export const Route = createFileRoute('/company')({
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
  forbidden: 'Only admins can edit the Company page.',
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
      <span className="label-sm">{props.label}</span>
      <div className="mt-1.5 space-y-1.5">
        {props.items.map((item, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              value={item}
              onChange={(e) => {
                const updated = [...props.items]
                updated[i] = e.target.value
                props.onChange(updated)
              }}
              className="input !h-8 w-full flex-1 !px-2.5 !text-sm"
            />
            <button
              type="button"
              disabled={i === 0}
              onClick={() => move(i, -1)}
              className="btn-ghost !h-8 !w-8 !px-0 !text-xs disabled:opacity-30"
              title="Move up"
            >
              ↑
            </button>
            <button
              type="button"
              disabled={i === props.items.length - 1}
              onClick={() => move(i, 1)}
              className="btn-ghost !h-8 !w-8 !px-0 !text-xs disabled:opacity-30"
              title="Move down"
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => props.onChange(props.items.filter((_, j) => j !== i))}
              className="btn-ghost !h-8 !w-8 !px-0 !text-xs"
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
        className="btn-secondary mt-2 !h-7 !px-2.5 !text-xs"
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
      <span className="label-sm">{props.label}</span>
      <input
        type="number"
        min={0}
        step={1}
        value={props.value ?? ''}
        onChange={(e) =>
          props.onChange(e.target.value === '' ? null : Number(e.target.value))
        }
        className="input tnum mt-1 w-full font-mono"
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
      <span className="label-sm">{props.label}</span>
      <input
        type="date"
        value={props.value ?? ''}
        onChange={(e) => props.onChange(e.target.value === '' ? null : e.target.value)}
        className="input tnum mt-1 w-full font-mono"
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
      <span className="label-sm">{props.label}</span>
      {props.textarea ? (
        <textarea
          rows={3}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          className="input mt-1 w-full"
        />
      ) : (
        <input
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          className="input mt-1 w-full"
        />
      )}
    </label>
  )
}

/** Interstitial divider between the vision and strategy/plan pages. */
function PageDivider(props: { title: string }) {
  return (
    <div className="mt-10 flex items-center gap-3">
      <h2 className="label-sm">{props.title}</h2>
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}

/** Numbered question section, per the strategy-document mockup. */
function QuestionBlock(props: { num: string; title: string; children: React.ReactNode }) {
  return (
    <section className="card mt-6 overflow-hidden">
      <header className="flex items-center justify-between border-b border-line px-5 py-3">
        <h3 className="flex items-baseline gap-2.5">
          <span className="tnum font-mono text-xs font-semibold text-beacon">{props.num}</span>
          <span className="text-sm font-semibold text-ink">{props.title}</span>
        </h3>
      </header>
      <div className="px-5 py-4">{props.children}</div>
    </section>
  )
}

/** Quiet mono-indexed list used for all read-view list fields. */
function StringList(props: { items: string[] }) {
  if (props.items.length === 0) return <p className="text-sm text-ink-faint">—</p>
  return (
    <ol className="space-y-1.5">
      {props.items.map((item, i) => (
        <li key={i} className="flex gap-2.5 text-sm text-ink">
          <span className="tnum pt-0.5 font-mono text-xs font-semibold text-ink-faint">{i + 1}</span>
          <span className="whitespace-pre-wrap">{item}</span>
        </li>
      ))}
    </ol>
  )
}

/** Small labeled metric tile (dates, revenue, profit) for the picture/plan sections. */
function MetricTile(props: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-canvas px-3 py-2.5">
      <p className="label-sm">{props.label}</p>
      <p className="tnum mt-1 font-mono text-sm font-semibold text-ink">{props.value}</p>
    </div>
  )
}

/** Page header block following the established page pattern (people.tsx). */
function PageIntro(props: { meta: string; action?: React.ReactNode }) {
  return (
    <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="label-sm">Strategic master file</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Company</h1>
        <p className="label-sm tnum mt-1.5">{props.meta}</p>
      </div>
      {props.action}
    </div>
  )
}

function CritError(props: { message: string }) {
  return (
    <p className="mt-4 rounded-md border border-crit-border bg-crit-surface px-3 py-2 text-sm text-crit-ink">
      {props.message}
    </p>
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
    if (!confirm('Restore this version? It becomes the published Company page (and a new version is recorded).'))
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

  if (!view) return <p className="p-8 text-sm text-ink-faint">Loading…</p>

  const publishedMeta = view.exists
    ? `published as of ${(view.publishedAt ?? view.updatedAt)?.slice(0, 10) ?? '—'}`
    : 'not yet written'

  if (!isAdmin) {
    return (
      <main className="mx-auto max-w-3xl px-8 py-10">
        <header className="flex items-center justify-between">
          <Link to="/" className="btn-ghost">
            ← Home
          </Link>
          <button onClick={handleSignOut} className="btn-ghost">
            Sign out
          </button>
        </header>
        <PageIntro meta={publishedMeta} />
        <ReadView view={view} values={values} />
      </main>
    )
  }

  if (!editing) {
    return (
      <main className="mx-auto max-w-3xl px-8 py-10 pb-16">
        <header className="flex items-center justify-between">
          <Link to="/" className="btn-ghost">
            ← Home
          </Link>
          <div className="flex items-center gap-2">
            <button onClick={handleSignOut} className="btn-ghost">
              Sign out
            </button>
          </div>
        </header>
        <PageIntro
          meta={publishedMeta}
          action={
            <button
              onClick={() => {
                setDraft(toForm(view))
                setEditing(true)
              }}
              className="btn-primary"
            >
              Edit Company
            </button>
          }
        />
        {error && <CritError message={error} />}
        <ReadView view={view} values={values} />
        <VersionHistory versions={versions} busy={busy} onRestore={handleRestore} />
        <CoreValuesPanel allValues={allValues} busy={busy} onChanged={refreshValues} />
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-3xl px-8 py-10 pb-16">
      <header className="flex items-center justify-between">
        <Link to="/" className="btn-ghost">
          ← Home
        </Link>
        <button onClick={handleSignOut} className="btn-ghost">
          Sign out
        </button>
      </header>
      <div className="mt-6">
        <p className="label-sm">Strategic master file</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Company</h1>
      </div>
      {error && <CritError message={error} />}
      <form onSubmit={handleSave} className="space-y-4">
        <QuestionBlock num="02" title="Core Focus">
          <div className="space-y-3">
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
        <QuestionBlock num="03" title="10-Year Target">
          <div className="space-y-3">
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
        <QuestionBlock num="04" title="Marketing Strategy">
          <div className="space-y-3">
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
        <QuestionBlock num="05" title="3-Year Picture">
          <div className="space-y-3">
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
        <QuestionBlock num="06" title="1-Year Plan">
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <label className="block text-sm">
                <span className="label-sm">Year</span>
                <input
                  value={draft.oneYearLabel}
                  onChange={(e) => set('oneYearLabel', e.target.value)}
                  placeholder="e.g. 2027"
                  className="input tnum mt-1 w-full font-mono"
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
          <button type="submit" disabled={busy} className="btn-primary">
            Save Company
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false)
              setError(null)
            }}
            className="btn-secondary"
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
      <PageDivider title="Page 1 — Vision" />
      <QuestionBlock num="01" title="Core Values">
        {props.values.length === 0 ? (
          <p className="text-sm text-ink-faint">No core values set yet.</p>
        ) : (
          <ol className="space-y-2">
            {props.values.map((value) => (
              <li key={value.id} className="rounded-md border border-line bg-canvas px-4 py-2.5">
                <p className="text-sm font-semibold text-ink">{value.name}</p>
                {value.description ? (
                  <p className="mt-0.5 text-sm text-ink-secondary">{value.description}</p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </QuestionBlock>
      <QuestionBlock num="02" title="Core Focus">
        <div className="rounded-md border border-line bg-canvas p-4">
          <p className="label-sm text-beacon">Purpose · Cause · Passion</p>
          <p className="mt-2 whitespace-pre-wrap text-lg font-medium leading-snug text-ink">
            {v.coreFocusWhy || '—'}
          </p>
        </div>
        <div className="mt-3">
          <p className="label-sm">What we do</p>
          <p className="mt-1 whitespace-pre-wrap text-sm font-medium text-ink">
            {v.coreFocusWhat || '—'}
          </p>
        </div>
      </QuestionBlock>
      <QuestionBlock num="03" title="10-Year Target">
        <div className="rounded-md bg-navy p-5 text-white">
          <div className="flex items-start justify-between gap-3">
            <p className="whitespace-pre-wrap text-lg font-medium leading-snug">
              {v.tenYearTarget || '—'}
            </p>
            {v.tenYearTargetDate ? (
              <span className="tnum shrink-0 rounded border border-white/25 px-2 py-1 font-mono text-xs text-white/80">
                Target: {v.tenYearTargetDate}
              </span>
            ) : null}
          </div>
        </div>
      </QuestionBlock>
      <PageDivider title="Page 2 — Strategy & Plan" />
      <QuestionBlock num="04" title="Marketing Strategy">
        <dl className="space-y-3">
          <div>
            <dt className="label-sm">Target market</dt>
            <dd className="mt-1 whitespace-pre-wrap text-sm text-ink">
              {v.marketingTargetMarket || '—'}
            </dd>
          </div>
          <div>
            <dt className="label-sm">Three uniques</dt>
            <dd className="mt-1">
              <StringList items={v.marketingThreeUniques} />
            </dd>
          </div>
          <div>
            <dt className="label-sm">Proven process</dt>
            <dd className="mt-1 whitespace-pre-wrap text-sm text-ink">
              {v.marketingProvenProcess || '—'}
            </dd>
          </div>
          <div>
            <dt className="label-sm">Guarantee</dt>
            <dd className="mt-1 whitespace-pre-wrap text-sm text-ink">
              {v.marketingGuarantee || '—'}
            </dd>
          </div>
        </dl>
      </QuestionBlock>
      <QuestionBlock num="05" title="3-Year Picture">
        <div className="grid grid-cols-3 gap-3">
          <MetricTile label="Date" value={v.threeYearDate ?? '—'} />
          <MetricTile label="Revenue" value={v.threeYearRevenue ?? '—'} />
          <MetricTile label="Profit" value={v.threeYearProfit ?? '—'} />
        </div>
        <div className="mt-4">
          <p className="label-sm">Looks like</p>
          <div className="mt-1.5">
            <StringList items={v.threeYearItems} />
          </div>
        </div>
      </QuestionBlock>
      <QuestionBlock num="06" title="1-Year Plan">
        <div className="grid grid-cols-3 gap-3">
          <MetricTile label="Year" value={v.oneYearLabel || '—'} />
          <MetricTile label="Revenue" value={v.oneYearRevenue ?? '—'} />
          <MetricTile label="Profit" value={v.oneYearProfit ?? '—'} />
        </div>
        <div className="mt-4">
          <p className="label-sm">Looks like</p>
          <div className="mt-1.5">
            <StringList items={v.oneYearItems} />
          </div>
        </div>
        <div className="mt-4">
          <p className="label-sm">Priorities</p>
          <div className="mt-1.5">
            <StringList items={v.oneYearPriorities} />
          </div>
        </div>
      </QuestionBlock>
      <QuestionBlock num="08" title="Issues List">
        <p className="text-sm text-ink-faint">
          Tracked by the Issues module (link lands when that module ships).
        </p>
      </QuestionBlock>
    </div>
  )
}
/** Admin-only version history (ticket 06): newest first, restore per entry. */
function VersionHistory(props: {
  versions: VtoVersionSummary[]
  busy: boolean
  onRestore: (versionId: number) => void
}) {
  return (
    <section className="card mt-6 p-4">
      <h2 className="label-sm">Version history</h2>
      {props.versions.length === 0 ? (
        <p className="mt-2 text-sm text-ink-faint">No versions yet — save the Company page once.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {props.versions.map((v, i) => (
            <li
              key={v.id}
              className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2 text-sm"
            >
              <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                <span className="tnum font-mono text-xs font-semibold text-ink">
                  #{props.versions.length - i}
                </span>
                <span className="tnum font-mono text-xs text-ink-secondary">
                  {v.publishedAt.slice(0, 19).replace('T', ' ')}
                </span>
                <span className="truncate text-xs text-ink-faint">by {v.authorEmail}</span>
                {i === 0 && <span className="badge badge-ok">current</span>}
              </span>
              {i !== 0 && (
                <button
                  disabled={props.busy}
                  onClick={() => props.onRestore(v.id)}
                  className="btn-secondary !h-7 !px-2.5 !text-xs"
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
    <section className="card mt-6 p-4">
      <div className="flex items-center justify-between">
        <h2 className="label-sm">Core values</h2>
        <button onClick={() => setAdding(!adding)} className="btn-secondary !h-7 !px-2.5 !text-xs">
          {adding ? 'Close' : '+ Add value'}
        </button>
      </div>
      {error && <CritError message={error} />}
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
            className="input !h-8 w-40 !px-2.5 !text-sm"
          />
          <input
            placeholder="Description (optional)"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            className="input !h-8 w-full !px-2.5 !text-sm"
          />
          <button
            type="submit"
            disabled={props.busy}
            className="btn-primary !h-8 !px-2.5 !text-xs"
          >
            Add
          </button>
        </form>
      )}
      <ul className="mt-3 space-y-1.5">
        {props.allValues.map((value, i) => (
          <li
            key={value.id}
            className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-sm"
          >
            <span className="flex gap-0.5">
              <button
                disabled={i === 0 || props.busy}
                onClick={() => move(i, -1)}
                className="btn-ghost !h-7 !w-7 !px-0 !text-xs disabled:opacity-30"
                title="Move up"
              >
                ↑
              </button>
              <button
                disabled={i === props.allValues.length - 1 || props.busy}
                onClick={() => move(i, 1)}
                className="btn-ghost !h-7 !w-7 !px-0 !text-xs disabled:opacity-30"
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
                  className="input !h-8 w-40 !px-2.5 !text-sm"
                />
                <input
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="input !h-8 w-full !px-2.5 !text-sm"
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
                  className="btn-primary !h-8 !px-2.5 !text-xs"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="btn-secondary !h-8 !px-2.5 !text-xs"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                <span className={value.active ? 'font-medium text-ink' : 'font-medium text-ink-faint'}>
                  {value.name}
                </span>
                {value.description ? (
                  <span className="text-ink-secondary"> — {value.description}</span>
                ) : null}
                {!value.active && <span className="badge badge-neutral">inactive</span>}
              </span>
            )}
            {editingId !== value.id && (
              <span className="flex gap-1.5">
                <button
                  onClick={() => {
                    setEditingId(value.id)
                    setEditName(value.name)
                    setEditDescription(value.description ?? '')
                  }}
                  className="btn-secondary !h-7 !px-2.5 !text-xs"
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
                    className="btn-secondary !h-7 !px-2.5 !text-xs"
                  >
                    Deactivate
                  </button>
                ) : (
                  <button
                    onClick={() =>
                      run(() => updateCoreValueFn({ data: { id: value.id, active: true } }))
                    }
                    className="btn-secondary !h-7 !px-2.5 !text-xs"
                  >
                    Reactivate
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
        {props.allValues.length === 0 && (
          <li className="py-2 text-center text-sm text-ink-faint">No core values yet.</li>
        )}
      </ul>
    </section>
  )
}