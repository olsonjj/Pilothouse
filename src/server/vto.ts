import type { Db } from './db'
import { vto, type Vto } from './schema'
import { requireRole, getCurrentUser } from './auth'
import { eq } from 'drizzle-orm'

/**
 * V/TO module (ticket 05): the single live version of the eight questions.
 * Everyone signed in can read; only admins save. Saving upserts the single
 * row (id 1) — no versioning in this ticket (that is ticket 06).
 */

export type VtoListInput = string[]

/** Input for updateVto — undefined fields are cleared to empty/null. */
export type VtoInput = {
  coreFocusWhy: string
  coreFocusWhat: string
  tenYearTarget?: string
  tenYearTargetDate?: string | null
  marketingTargetMarket?: string
  marketingThreeUniques?: string[]
  marketingProvenProcess?: string
  marketingGuarantee?: string
  threeYearDate?: string | null
  threeYearRevenue?: number | null
  threeYearProfit?: number | null
  threeYearItems?: string[]
  oneYearLabel?: string
  oneYearRevenue?: number | null
  oneYearProfit?: number | null
  oneYearItems?: string[]
  oneYearPriorities?: string[]
}

export type VtoView = {
  /** False = never saved yet (all fields at defaults). */
  exists: boolean
  /** "as of" timestamp of the live content (updated_at of the row). */
  updatedAt: string | null
  coreFocusWhy: string
  coreFocusWhat: string
  tenYearTarget: string
  tenYearTargetDate: string | null
  marketingTargetMarket: string
  marketingThreeUniques: string[]
  marketingProvenProcess: string
  marketingGuarantee: string
  threeYearDate: string | null
  threeYearRevenue: number | null
  threeYearProfit: number | null
  threeYearItems: string[]
  oneYearLabel: string
  oneYearRevenue: number | null
  oneYearProfit: number | null
  oneYearItems: string[]
  oneYearPriorities: string[]
}

export type VtoError =
  | 'unauthenticated'
  | 'forbidden'
  | 'missing_required'
  | 'invalid_list'
  | 'invalid_number'
  | 'invalid_date'

export type VtoResult<T> = { ok: true; value: T } | { ok: false; error: VtoError }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Safely parse a JSON string-array column; corrupt data degrades to []. */
function parseList(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

function toView(row: Vto): VtoView {
  return {
    exists: true,
    updatedAt: row.updatedAt,
    coreFocusWhy: row.coreFocusWhy ?? '',
    coreFocusWhat: row.coreFocusWhat ?? '',
    tenYearTarget: row.tenYearTarget ?? '',
    tenYearTargetDate: row.tenYearTargetDate,
    marketingTargetMarket: row.marketingTargetMarket ?? '',
    marketingThreeUniques: parseList(row.marketingThreeUniques),
    marketingProvenProcess: row.marketingProvenProcess ?? '',
    marketingGuarantee: row.marketingGuarantee ?? '',
    threeYearDate: row.threeYearDate,
    threeYearRevenue: row.threeYearRevenue,
    threeYearProfit: row.threeYearProfit,
    threeYearItems: parseList(row.threeYearItems),
    oneYearLabel: row.oneYearLabel ?? '',
    oneYearRevenue: row.oneYearRevenue,
    oneYearProfit: row.oneYearProfit,
    oneYearItems: parseList(row.oneYearItems),
    oneYearPriorities: parseList(row.oneYearPriorities),
  }
}

const EMPTY_VIEW: VtoView = {
  exists: false,
  updatedAt: null,
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

/** The live V/TO. Empty state returns defaults, not an error. */
export async function getVto(db: Db, token: string | undefined): Promise<VtoResult<VtoView>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const row = await db.select().from(vto).where(eq(vto.id, 1)).get()
  return { ok: true, value: row ? toView(row) : EMPTY_VIEW }
}

function validateList(raw: unknown): string[] | 'invalid' {
  if (raw == null) return []
  if (!Array.isArray(raw)) return 'invalid'
  const items: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') return 'invalid'
    const trimmed = item.trim()
    if (trimmed === '') continue
    if (trimmed.length > 200) return 'invalid' // list items are short strings
    items.push(trimmed)
  }
  return items
}

function validateMoney(raw: unknown): number | null | 'invalid' {
  if (raw == null || raw === '') return null
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) return 'invalid'
  return raw
}

function validateDate(raw: unknown): string | null | 'invalid' {
  if (raw == null || raw === '') return null
  if (typeof raw !== 'string' || !DATE_RE.test(raw)) return 'invalid'
  // Real calendar check (e.g. month 13 must fail): round-trip through Date.
  const parsed = new Date(`${raw}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    return 'invalid'
  }
  return raw
}

export async function updateVto(
  db: Db,
  token: string | undefined,
  input: VtoInput,
): Promise<VtoResult<VtoView>> {
  const auth = await requireRole(db, token, 'admin')
  if (!auth.ok) return auth

  // Required fields: the core focus is the heart of the document.
  const why = input.coreFocusWhy?.trim() ?? ''
  const what = input.coreFocusWhat?.trim() ?? ''
  if (!why || !what) return { ok: false, error: 'missing_required' }

  const uniques = validateList(input.marketingThreeUniques)
  if (uniques === 'invalid') return { ok: false, error: 'invalid_list' }
  if (uniques.length > 3) return { ok: false, error: 'invalid_list' } // EOS: three uniques

  const threeYearItems = validateList(input.threeYearItems)
  if (threeYearItems === 'invalid') return { ok: false, error: 'invalid_list' }
  const oneYearItems = validateList(input.oneYearItems)
  if (oneYearItems === 'invalid') return { ok: false, error: 'invalid_list' }
  const oneYearPriorities = validateList(input.oneYearPriorities)
  if (oneYearPriorities === 'invalid') return { ok: false, error: 'invalid_list' }

  const threeYearRevenue = validateMoney(input.threeYearRevenue)
  if (threeYearRevenue === 'invalid') return { ok: false, error: 'invalid_number' }
  const threeYearProfit = validateMoney(input.threeYearProfit)
  if (threeYearProfit === 'invalid') return { ok: false, error: 'invalid_number' }
  const oneYearRevenue = validateMoney(input.oneYearRevenue)
  if (oneYearRevenue === 'invalid') return { ok: false, error: 'invalid_number' }
  const oneYearProfit = validateMoney(input.oneYearProfit)
  if (oneYearProfit === 'invalid') return { ok: false, error: 'invalid_number' }

  const tenYearTargetDate = validateDate(input.tenYearTargetDate)
  if (tenYearTargetDate === 'invalid') return { ok: false, error: 'invalid_date' }
  const threeYearDate = validateDate(input.threeYearDate)
  if (threeYearDate === 'invalid') return { ok: false, error: 'invalid_date' }

  const values = {
    id: 1,
    coreFocusWhy: why,
    coreFocusWhat: what,
    tenYearTarget: input.tenYearTarget?.trim().slice(0, 2000) || null,
    tenYearTargetDate,
    marketingTargetMarket: input.marketingTargetMarket?.trim().slice(0, 2000) || null,
    marketingThreeUniques: JSON.stringify(uniques),
    marketingProvenProcess: input.marketingProvenProcess?.trim().slice(0, 2000) || null,
    marketingGuarantee: input.marketingGuarantee?.trim().slice(0, 2000) || null,
    threeYearDate,
    threeYearRevenue,
    threeYearProfit,
    threeYearItems: JSON.stringify(threeYearItems),
    oneYearLabel: input.oneYearLabel?.trim().slice(0, 20) || null,
    oneYearRevenue,
    oneYearProfit,
    oneYearItems: JSON.stringify(oneYearItems),
    oneYearPriorities: JSON.stringify(oneYearPriorities),
    updatedAt: new Date().toISOString(),
  }

  // Single-row upsert (id 1).
  await db
    .insert(vto)
    .values(values)
    .onConflictDoUpdate({ target: vto.id, set: values })

  const row = (await db.select().from(vto).where(eq(vto.id, 1)).get())!
  return { ok: true, value: toView(row) }
}