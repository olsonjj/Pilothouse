import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { getDb } from '../server/db'
import { SESSION_COOKIE } from '../server/auth'
import {
  createTodo,
  completeTodo,
  dropTodo,
  listMyTodos,
  listOpenTodos,
  type TodoInput,
} from '../server/todos'

/** Thin cookie-layer wrappers around src/server/todos.ts. */

export const listMyTodosFn = createServerFn({ method: 'GET' }).handler(async () => {
  const db = await getDb()
  return listMyTodos(db, getCookie(SESSION_COOKIE))
})

export const listOpenTodosFn = createServerFn({ method: 'GET' }).handler(async () => {
  const db = await getDb()
  return listOpenTodos(db, getCookie(SESSION_COOKIE))
})

export const createTodoFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { title?: string; assigneePersonId?: number })
  .handler(async ({ data }) => {
    const db = await getDb()
    const input: TodoInput = {
      title: data.title ?? '',
      assigneePersonId: data.assigneePersonId ?? 0,
    }
    return createTodo(db, getCookie(SESSION_COOKIE), input)
  })

export const completeTodoFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { todoId?: number })
  .handler(async ({ data }) => {
    const db = await getDb()
    return completeTodo(db, getCookie(SESSION_COOKIE), data.todoId ?? 0)
  })

export const dropTodoFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { todoId?: number; reason?: string })
  .handler(async ({ data }) => {
    const db = await getDb()
    return dropTodo(db, getCookie(SESSION_COOKIE), data.todoId ?? 0, data.reason ?? '')
  })