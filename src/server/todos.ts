import type { Db } from './db'
import { people, todos, type Todo } from './schema'
import { getCurrentUser } from './auth'
import { formatWeekLabel, parseDate, todayIso, weekStart } from './week'
import { and, asc, eq, gte, lt, sql, type SQL } from 'drizzle-orm'

/**
 * To-dos domain module (ticket 11): the 7-day action items. Due dates are
 * FIXED at creation (today + 7 days — decided in docs/specs/todos.md); status
 * is open → done (immutable record) or open → dropped (requires a reason).
 * Any signed-in user can create for anyone and complete/drop any to-do — the
 * decided access model (data-model.md) makes this a shared team workspace;
 * "update own to-dos" bounds what members *must* be able to do, not a limit
 * (no private to-dos exist). Viewing is equally open. Team view + completion
 * rates are ticket 12; here only my-to-dos and the simple open list.
 */

export type TodoInput = {
  title: string
  assigneePersonId: number
}

export type TodoView = Todo & {
  /** Assignee display name (people.full_name), joined at read time. */
  assigneeName: string
}

export type TodoError =
  | 'unauthenticated'
  | 'forbidden'
  | 'title_required'
  | 'not_found'
  | 'assignee_not_found'
  | 'invalid_state'

export type TodoResult<T> = { ok: true; value: T } | { ok: false; error: TodoError }

/** Fixed due date: the creation date + 7 days (UTC-noon math, TZ-proof). */
export function dueDateFrom(createdDate: string): string {
  const created = parseDate(createdDate)
  return new Date(created.getTime() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
}

/**
 * The signed-in user's linked person id (or null). Views filter by it; an
 * unlinked account sees an empty my-list rather than an error.
 */

/** Reads a to-do row by id. */
async function getTodoRow(db: Db, todoId: number): Promise<Todo | null> {
  return (await db.select().from(todos).where(eq(todos.id, todoId)).get()) ?? null
}

export async function createTodo(
  db: Db,
  token: string | undefined,
  input: TodoInput,
): Promise<TodoResult<Todo>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const title = input.title?.trim() ?? ''
  if (!title) return { ok: false, error: 'title_required' }
  // Creator = the login account (works for unlinked users like the seeded owner).
  const creator = auth.user.id
  const assignee = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.id, input.assigneePersonId))
    .get()
  if (!assignee) return { ok: false, error: 'assignee_not_found' }
  const [todo] = await db
    .insert(todos)
    .values({
      title,
      assigneePersonId: input.assigneePersonId,
      createdBy: creator,
      dueDate: dueDateFrom(todayIso()),
    })
    .returning()
  return { ok: true, value: todo! }
}

export async function completeTodo(
  db: Db,
  token: string | undefined,
  todoId: number,
): Promise<TodoResult<Todo>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const todo = await getTodoRow(db, todoId)
  if (!todo) return { ok: false, error: 'not_found' }
  if (todo.status !== 'open') return { ok: false, error: 'invalid_state' }
  const [updated] = await db
    .update(todos)
    .set({ status: 'done', completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .where(eq(todos.id, todoId))
    .returning()
  return { ok: true, value: updated! }
}

export async function dropTodo(
  db: Db,
  token: string | undefined,
  todoId: number,
  reason: string,
): Promise<TodoResult<Todo>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const trimmed = reason?.trim() ?? ''
  if (!trimmed) return { ok: false, error: 'invalid_state' }
  const todo = await getTodoRow(db, todoId)
  if (!todo) return { ok: false, error: 'not_found' }
  if (todo.status !== 'open') return { ok: false, error: 'invalid_state' }
  const [updated] = await db
    .update(todos)
    .set({ status: 'dropped', dropReason: trimmed, updatedAt: new Date().toISOString() })
    .where(eq(todos.id, todoId))
    .returning()
  return { ok: true, value: updated! }
}

/**
 * The signed-in user's own to-dos (all statuses, so done/dropped history is
 * visible on their list), sorted by due date. Unlinked accounts see nothing.
 */
export async function listMyTodos(
  db: Db,
  token: string | undefined,
): Promise<TodoResult<TodoView[]>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const me = auth.user.personId
  if (me == null) return { ok: true, value: [] }
  return listFor(db, eq(todos.assigneePersonId, me))
}

/** All open to-dos for everyone, overdue-first then due date (ticket 12). */
export async function listOpenTodos(
  db: Db,
  token: string | undefined,
): Promise<TodoResult<TodoView[]>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  // Overdue open to-dos sort FIRST (spec: surfaced, red, first), then due
  // date, then id — implemented as two ordered queries (overdue, then rest).
  const today = todayIso()
  const overdue = await listForRows(
    db,
    and(eq(todos.status, 'open'), lt(todos.dueDate, today)),
  )
  if (!overdue.ok) return overdue
  const upcoming = await listForRows(
    db,
    and(eq(todos.status, 'open'), gte(todos.dueDate, today)),
  )
  if (!upcoming.ok) return upcoming
  return { ok: true, value: [...overdue.value, ...upcoming.value] }
}

/** Shared list shape: assignee name joined; SQL-aliased per the driver rule. */
async function listForRows(
  db: Db,
  where: SQL | undefined,
  order: SQL[] = [asc(todos.dueDate), asc(todos.id)],
): Promise<TodoResult<TodoView[]>> {
  // Join columns must be SQL-aliased uniquely (node:sqlite proxy driver —
  // see db.ts): both tables have `id`, and todos.created_by joins people too.
  const rows = await db
    .select({
      t_id: todos.id,
      t_title: todos.title,
      t_due_date: todos.dueDate,
      t_status: todos.status,
      t_completed_at: todos.completedAt,
      t_drop_reason: todos.dropReason,
      t_assignee_person_id: todos.assigneePersonId,
      t_created_by: todos.createdBy,
      t_created_at: todos.createdAt,
      t_updated_at: todos.updatedAt,
      t_source_meeting_id: todos.sourceMeetingId,
      t_issue_source_id: todos.issueSourceId,
      assignee_name: people.fullName,
    })
    .from(todos)
    .innerJoin(people, eq(people.id, todos.assigneePersonId))
    .where(where)
    .orderBy(...order)
  return {
    ok: true,
    value: rows.map((r) => ({
      id: r.t_id,
      title: r.t_title,
      assigneePersonId: r.t_assignee_person_id,
      createdBy: r.t_created_by,
      dueDate: r.t_due_date,
      status: r.t_status as Todo['status'],
      completedAt: r.t_completed_at,
      dropReason: r.t_drop_reason,
      sourceMeetingId: r.t_source_meeting_id,
      issueSourceId: r.t_issue_source_id,
      createdAt: r.t_created_at,
      updatedAt: r.t_updated_at,
      assigneeName: r.assignee_name,
    })),
  }
}

async function listFor(
  db: Db,
  where: SQL | undefined,
): Promise<TodoResult<TodoView[]>> {
  return listForRows(db, where)
}


// ---------------------------------------------------------------------------
// Ticket 12: team view by week + rolling completion rates.
// ---------------------------------------------------------------------------

/** One week bucket of the team view (week identified by its Monday date). */
export type WeekBucket = {
  /** Monday ISO date of the week. */
  weekMonday: string
  /** "Week of Mar 3" label. */
  label: string
  todos: TodoView[]
}

/**
 * Team view: every to-do grouped by the week of its due date
 * (weekStart(due_date)), buckets sorted chronologically. All statuses are
 * included (open/done/dropped are all part of the week's record); the UI
 * renders statuses distinctly.
 */
export async function listTodosByWeek(
  db: Db,
  token: string | undefined,
): Promise<TodoResult<WeekBucket[]>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const all = await listForRows(db, undefined)
  if (!all.ok) return all
  const buckets = new Map<string, TodoView[]>()
  for (const todo of all.value) {
    const monday = weekStart(todo.dueDate)
    const bucket = buckets.get(monday)
    if (bucket) bucket.push(todo)
    else buckets.set(monday, [todo])
  }
  return {
    ok: true,
    value: [...buckets.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([weekMonday, weekTodos]) => ({
        weekMonday,
        label: formatWeekLabel(weekMonday),
        todos: weekTodos,
      })),
  }
}

// Completion rates -----------------------------------------------------------

export type PersonCompletion = {
  personId: number
  personName: string
  /** To-dos in the window that count and were completed. */
  done: number
  /** To-dos in the window that count (done + open); dropped are EXCLUDED. */
  counted: number
  /** Rate as a percentage (0–100), one decimal; null when nothing counted. */
  rate: number | null
}

export type CompletionRates = {
  /** First day (inclusive) of the rate window. */
  windowStart: string
  /** Last day (exclusive) of the rate window. */
  windowEnd: string
  team: { done: number; counted: number; rate: number | null }
  people: PersonCompletion[]
}

/**
 * Rolling 4-week completion rate (spec: docs/specs/todos.md — the ~90% norm,
 * kept honest by required drop reasons).
 *
 * Formula (documented in data-model.md):
 * - Window: the 4 FULLY-ELAPSED weeks before the week containing `asOf`
 *   (default today) — i.e. due_date in [weekStart(asOf) - 28 days,
 *   weekStart(asOf) - 1 day]. A week that hasn't ended can't be scored.
 * - Counted (denominator): to-dos due in the window with status done OR open
 *   (open-and-past-due = missed, which is the honesty part of the rate).
 * - Done (numerator): status done.
 * - Dropped: EXCLUDED from both — a to-do deliberately dropped with a reason
 *   was never going to be done; counting it would punish the drop (which the
 *   reason legitimizes) and inflate nothing. The drop reason stays visible in
 *   the team view.
 * - rate = done / counted * 100, one decimal; null when counted == 0.
 * Derived from the todos table on every call — no rollup tables (decided).
 */
export async function completionRates(
  db: Db,
  token: string | undefined,
  asOfDate: string = todayIso(),
): Promise<TodoResult<CompletionRates>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  const thisMonday = parseDate(weekStart(asOfDate))
  const windowStartMs = thisMonday.getTime() - 28 * 24 * 60 * 60 * 1000
  const windowEndMs = thisMonday.getTime()
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  const windowStart = iso(windowStartMs)
  const windowEnd = iso(windowEndMs)

  // Counted rows: due in window, status done or open (dropped excluded).
  const rows = await db
    .select({
      person_id: people.id,
      person_name: people.fullName,
      status: todos.status,
      n: sql<number>`COUNT(*)`,
    })
    .from(todos)
    .innerJoin(people, eq(people.id, todos.assigneePersonId))
    .where(
      and(
        gte(todos.dueDate, windowStart),
        lt(todos.dueDate, windowEnd),
        // status IN ('done','open') — NOT dropped.
        sql`${todos.status} IN ('done', 'open')`,
      ),
    )
    .groupBy(people.id, people.fullName, todos.status)

  const team = { done: 0, counted: 0, rate: null as number | null }
  const byPerson = new Map<number, { personName: string; done: number; counted: number }>()
  for (const row of rows) {
    const personId = Number(row.person_id)
    const n = Number(row.n)
    const entry = byPerson.get(personId) ?? {
      personName: row.person_name,
      done: 0,
      counted: 0,
    }
    entry.counted += n
    team.counted += n
    if (row.status === 'done') {
      entry.done += n
      team.done += n
    }
    byPerson.set(personId, entry)
  }
  const rate = (done: number, counted: number): number | null =>
    counted === 0 ? null : Math.round((done / counted) * 1000) / 10
  team.rate = rate(team.done, team.counted)
  const peopleRates: PersonCompletion[] = [...byPerson.entries()]
    .map(([personId, e]) => ({
      personId,
      personName: e.personName,
      done: e.done,
      counted: e.counted,
      rate: rate(e.done, e.counted),
    }))
    .sort((a, b) => a.personName.localeCompare(b.personName))
  return {
    ok: true,
    value: { windowStart, windowEnd, team, people: peopleRates },
  }
}
