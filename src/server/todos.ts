import type { Db } from './db'
import { people, todos, type Todo } from './schema'
import { getCurrentUser } from './auth'
import { todayIso, parseDate } from './week'
import { asc, eq, type SQL } from 'drizzle-orm'

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

/** All open to-dos for everyone, sorted by due date (cheap team view). */
export async function listOpenTodos(
  db: Db,
  token: string | undefined,
): Promise<TodoResult<TodoView[]>> {
  const auth = await getCurrentUser(db, token)
  if (!auth.ok) return auth
  return listFor(db, eq(todos.status, 'open'))
}

/** Shared list shape: assignee name joined; SQL-aliased per the driver rule. */
async function listFor(
  db: Db,
  where: SQL,
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
    .orderBy(asc(todos.dueDate))
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

