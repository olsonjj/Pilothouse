import { createServerFn } from '@tanstack/react-start'
import { getCookie, setCookie, deleteCookie } from '@tanstack/react-start/server'
import { getDb } from '../server/db'
import {
  SESSION_COOKIE,
  SESSION_TTL_DAYS,
  signIn,
  signOut,
  getCurrentUser,
  requireRole,
  type PublicUser,
} from '../server/auth'

export type AuthResult = { ok: true; user: PublicUser } | { ok: false; error: string }

/** Sign in: verify credentials, create a session, set the httpOnly cookie. */
export const signInFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { email?: string; password?: string })
  .handler(async ({ data }) => {
    const db = await getDb()
    const result = await signIn(db, data.email ?? '', data.password ?? '')
    if (result.ok) {
      setCookie(SESSION_COOKIE, result.sessionToken, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
      })
      return { ok: true, user: result.user } as const
    }
    return { ok: false, error: result.error } as const
  })

/** End the current session and clear the cookie. */
export const signOutFn = createServerFn({ method: 'POST' }).handler(async () => {
  const db = await getDb()
  await signOut(db, getCookie(SESSION_COOKIE))
  deleteCookie(SESSION_COOKIE, { path: '/' })
  return { ok: true } as const
})

/** The current signed-in user (or none). Used by the route auth guard. */
export const getCurrentUserFn = createServerFn({ method: 'GET' }).handler(async () => {
  const db = await getDb()
  const result = await getCurrentUser(db, getCookie(SESSION_COOKIE))
  return result.ok
    ? ({ ok: true, user: result.user } as const)
    : ({ ok: false, error: 'unauthenticated' } as const)
})

/**
 * Example admin-only action proving role enforcement lives in the server
 * layer (tests exercise requireRole through the seam). Real admin actions
 * arrive with later tickets and must call requireRole the same way.
 */
export const adminOnlyActionFn = createServerFn({ method: 'POST' }).handler(async () => {
  const db = await getDb()
  const result = await requireRole(db, getCookie(SESSION_COOKIE), 'admin')
  return result.ok
    ? ({ ok: true, user: result.user } as const)
    : ({ ok: false, error: result.error } as const)
})