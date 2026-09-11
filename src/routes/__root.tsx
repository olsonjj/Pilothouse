import { HeadContent, Scripts, createRootRoute, redirect } from '@tanstack/react-router'

import appCss from '../styles.css?url'
import { getCurrentUserFn } from '../functions/auth'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Boardroom' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  // Route-level auth guard: unauthenticated users land on /signin.
  beforeLoad: async ({ location }) => {
    if (location.pathname === '/signin') return
    const result = await getCurrentUserFn()
    if (!result.ok) {
      throw redirect({ to: '/signin', search: { next: location.pathname } })
    }
  },
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="bg-slate-50 text-slate-900 min-h-screen antialiased">{children}</body>
      <Scripts />
    </html>
  )
}