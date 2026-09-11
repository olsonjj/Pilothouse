import type { Db } from './db'
import { vto, vtoVersions, type Vto } from './schema'
import { requireRole, getCurrentUser } from './auth'
import { desc, eq, sql } from 'drizzle-orm'

/**
 * Company module (tickets 05+06): the single live version of the eight questions
 * plus an append-only snapshot history (vto_versions). Everyone signed in can
 * read; only admins save/restore/list versions. Each save upserts the live row
 * (id 1) AND inserts a snapshot (author + published_at). Restores copy a
 * version's content into the live row and append a NEW version — never
 * destructive.
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
  /**
   * Ticket 06 semantics: published_at of the newest snapshot (by published_at,
   * tie-broken by id) — i.e. when this content became the published version.
   * Falls back to the live row's updated_at if no snapshot exists; null when
   * never saved.
   */
  publishedAt: string | null
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
  | 'not_found'

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

/**
 * Map a live row or snapshot's shared content columns into the view shape.
 * updatedAt/publishedAt are passed explicitly (snapshots carry published_at,
 * not updated_at).
 */
function toView(
  row: Pick<Vto, (typeof vtoContentColumns)[number]>,
  updatedAt: string | null,
  publishedAt: string | null,
): VtoView {
  return {
    exists: true,
    updatedAt,
    publishedAt,
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
  publishedAt: null,
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

/** The live company vision document. Empty state returns defaults, not an error. */
export async function getVto(db: Db, token: string | undefined): Promise<VtoResult<VtoView>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const row = await db.select().from(vto).where(eq(vto.id, 1)).get()
  if (!row) return { ok: true, value: EMPTY_VIEW }
  // Published-as-of = newest snapshot (published_at desc, id desc); the live
  // row's updated_at is the fallback (identical in practice — every save
  // versions — but guards against a hand-written vto row with no history).
  const latest = await db
    .select({ publishedAt: vtoVersions.publishedAt })
    .from(vtoVersions)
    .orderBy(desc(vtoVersions.publishedAt), desc(vtoVersions.id))
    .limit(1)
    .get()
  return { ok: true, value: toView(row, row.updatedAt, latest?.publishedAt ?? row.updatedAt) }
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

  // Every save is a new version (ticket 06): whole-snapshot, author + time.
  const publishedAt = values.updatedAt
  await insertSnapshot(db, values, publishedAt, auth.user.id)

  const row = (await db.select().from(vto).where(eq(vto.id, 1)).get())!
  return { ok: true, value: toView(row, row.updatedAt, publishedAt) }
}

/** Content columns shared between the live `vto` row and `vto_versions`. */
const vtoContentColumns = [
  'coreFocusWhy', 'coreFocusWhat', 'tenYearTarget', 'tenYearTargetDate',
  'marketingTargetMarket', 'marketingThreeUniques', 'marketingProvenProcess',
  'marketingGuarantee', 'threeYearDate', 'threeYearRevenue', 'threeYearProfit',
  'threeYearItems', 'oneYearLabel', 'oneYearRevenue', 'oneYearProfit',
  'oneYearItems', 'oneYearPriorities',
] as const

/** Insert a snapshot row from shared content columns. */
async function insertSnapshot(
  db: Db,
  content: Pick<Vto, (typeof vtoContentColumns)[number]>,
  publishedAt: string,
  createdBy: number,
): Promise<void> {
  await db.insert(vtoVersions).values({
    publishedAt,
    createdBy,
    coreFocusWhy: content.coreFocusWhy,
    coreFocusWhat: content.coreFocusWhat,
    tenYearTarget: content.tenYearTarget,
    tenYearTargetDate: content.tenYearTargetDate,
    marketingTargetMarket: content.marketingTargetMarket,
    marketingThreeUniques: content.marketingThreeUniques,
    marketingProvenProcess: content.marketingProvenProcess,
    marketingGuarantee: content.marketingGuarantee,
    threeYearDate: content.threeYearDate,
    threeYearRevenue: content.threeYearRevenue,
    threeYearProfit: content.threeYearProfit,
    threeYearItems: content.threeYearItems,
    oneYearLabel: content.oneYearLabel,
    oneYearRevenue: content.oneYearRevenue,
    oneYearProfit: content.oneYearProfit,
    oneYearItems: content.oneYearItems,
    oneYearPriorities: content.oneYearPriorities,
  })
}
// ---------------------------------------------------------------------------
// Version history (ticket 06)
// ---------------------------------------------------------------------------

/** One entry in the version history list (admin only). */
export type VtoVersionSummary = {
  id: number
  publishedAt: string
  /** Author email of the save/restore that produced the snapshot. */
  authorEmail: string
}

export type VtoVersionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: 'unauthenticated' | 'forbidden' | 'not_found' }

/** Append-only history, newest first. Join-aliasing constraint applies (db.ts). */
export async function listVtoVersions(
  db: Db,
  token: string | undefined,
): Promise<VtoVersionResult<VtoVersionSummary[]>> {
  const auth = await requireRole(db, token, 'admin')
  if (!auth.ok) return auth
  const rows = await db
    .select({
      id: sql<number>`"vto_versions"."id"`.as('v_id'),
      publishedAt: sql<string>`"vto_versions"."published_at"`.as('v_published_at'),
      authorEmail: sql<string>`"users"."email"`.as('u_email'),
    })
    .from(vtoVersions)
    .innerJoin(sql`"users"`, sql`"users"."id" = "vto_versions"."created_by"`)
    .orderBy(desc(sql`"vto_versions"."published_at"`), desc(sql`"vto_versions"."id"`))
  return {
    ok: true,
    value: rows.map((r) => ({
      id: Number(r.id),
      publishedAt: r.publishedAt,
      authorEmail: r.authorEmail,
    })),
  }
}

/**
 * Restore a version: copy its content into the live row AND append a NEW
 * version snapshot (history is append-only; the restored snapshot stays).
 */
export async function restoreVtoVersion(
  db: Db,
  token: string | undefined,
  versionId: number,
): Promise<VtoResult<VtoView>> {
  const auth = await requireRole(db, token, 'admin')
  if (!auth.ok) return auth
  const version = await db.select().from(vtoVersions).where(eq(vtoVersions.id, versionId)).get()
  if (!version) return { ok: false, error: 'not_found' }

  const updatedAt = new Date().toISOString()
  await db
    .insert(vto)
    .values({
      id: 1,
      coreFocusWhy: version.coreFocusWhy,
      coreFocusWhat: version.coreFocusWhat,
      tenYearTarget: version.tenYearTarget,
      tenYearTargetDate: version.tenYearTargetDate,
      marketingTargetMarket: version.marketingTargetMarket,
      marketingThreeUniques: version.marketingThreeUniques,
      marketingProvenProcess: version.marketingProvenProcess,
      marketingGuarantee: version.marketingGuarantee,
      threeYearDate: version.threeYearDate,
      threeYearRevenue: version.threeYearRevenue,
      threeYearProfit: version.threeYearProfit,
      threeYearItems: version.threeYearItems,
      oneYearLabel: version.oneYearLabel,
      oneYearRevenue: version.oneYearRevenue,
      oneYearProfit: version.oneYearProfit,
      oneYearItems: version.oneYearItems,
      oneYearPriorities: version.oneYearPriorities,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: vto.id,
      set: {
        coreFocusWhy: version.coreFocusWhy,
        coreFocusWhat: version.coreFocusWhat,
        tenYearTarget: version.tenYearTarget,
        tenYearTargetDate: version.tenYearTargetDate,
        marketingTargetMarket: version.marketingTargetMarket,
        marketingThreeUniques: version.marketingThreeUniques,
        marketingProvenProcess: version.marketingProvenProcess,
        marketingGuarantee: version.marketingGuarantee,
        threeYearDate: version.threeYearDate,
        threeYearRevenue: version.threeYearRevenue,
        threeYearProfit: version.threeYearProfit,
        threeYearItems: version.threeYearItems,
        oneYearLabel: version.oneYearLabel,
        oneYearRevenue: version.oneYearRevenue,
        oneYearProfit: version.oneYearProfit,
        oneYearItems: version.oneYearItems,
        oneYearPriorities: version.oneYearPriorities,
        updatedAt,
      },
    })

  // Append-only: restoring creates a NEW version row attributed to the
  // restorer; the original snapshots remain untouched.
  const publishedAt = updatedAt
  await insertSnapshot(db, version, publishedAt, auth.user.id)

  return { ok: true, value: toView(version, updatedAt, publishedAt) }
}

/**
 * Idempotent migration backfill (runs on every DB init, like the quarter
 * seeder): if the vto row exists but no version does, copy it into the first
 * version. Cheap enough to run unconditionally; author = the owner.
 */
export async function backfillVtoFirstVersion(db: Db): Promise<void> {
  await db.run(sql`
    INSERT INTO "vto_versions" (
      "published_at", "created_by",
      "core_focus_why", "core_focus_what", "ten_year_target", "ten_year_target_date",
      "marketing_target_market", "marketing_three_uniques", "marketing_proven_process",
      "marketing_guarantee", "three_year_date", "three_year_revenue", "three_year_profit",
      "three_year_items", "one_year_label", "one_year_revenue", "one_year_profit",
      "one_year_items", "one_year_priorities"
    )
    SELECT
      "vto"."updated_at", "users"."id",
      "vto"."core_focus_why", "vto"."core_focus_what", "vto"."ten_year_target",
      "vto"."ten_year_target_date",
      "vto"."marketing_target_market", "vto"."marketing_three_uniques",
      "vto"."marketing_proven_process", "vto"."marketing_guarantee",
      "vto"."three_year_date", "vto"."three_year_revenue", "vto"."three_year_profit",
      "vto"."three_year_items", "vto"."one_year_label", "vto"."one_year_revenue",
      "vto"."one_year_profit", "vto"."one_year_items", "vto"."one_year_priorities"
    FROM "vto"
    CROSS JOIN (SELECT "id" FROM "users" ORDER BY "id" LIMIT 1) AS "users"
    WHERE "vto"."id" = 1
      AND NOT EXISTS (SELECT 1 FROM "vto_versions")
  `)
}
