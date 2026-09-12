import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { signInFn } from '../functions/auth'

export const Route = createFileRoute('/signin')({ component: SignIn })

function SignIn() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const result = await signInFn({ data: { email, password } })
    setBusy(false)
    if (result.ok) {
      await navigate({ to: '/' })
    } else {
      setError('Invalid email or password.')
    }
  }

  return (
    <main
      className="flex min-h-screen items-center justify-center px-4"
      style={{
        background:
          'radial-gradient(ellipse 60% 45% at 50% 0%, rgba(3, 105, 161, 0.07), transparent), var(--color-canvas)',
      }}
    >
      <div className="w-full max-w-sm">
        <form
          onSubmit={handleSubmit}
          className="card rounded-xl px-8 py-8"
          style={{ boxShadow: '0 1px 3px 0 rgba(15, 23, 42, 0.08), 0 4px 6px -2px rgba(15, 23, 42, 0.04)' }}
        >
          {/* Brand row */}
          <img
            src="/pilothouse-logo.png"
            alt="Pilothouse — Operating System"
            className="h-12 w-auto"
          />

          <h1 className="mt-6 text-2xl font-semibold leading-8 tracking-[-0.015em] text-ink">
            Sign in to your company
          </h1>
          <p className="mt-1 text-sm leading-5 text-ink-secondary">
            Enter your company credentials to access your operating deck.
          </p>

          <div className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-ink">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="input mt-1.5 w-full"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-ink">
                Password
              </label>
              <div className="relative mt-1.5">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input w-full pr-14"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-sm text-ink-muted hover:text-ink"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
          </div>

          {error && (
            <p className="mt-3 rounded border border-crit-border bg-crit-surface px-3 py-2 text-sm text-crit-ink">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="btn-primary btn-lg mt-6 w-full text-base"
          >
            {busy ? 'Signing in…' : 'Sign in'}
            {!busy && <span aria-hidden>→</span>}
          </button>

          {/* Footer note */}
          <div className="mt-6 flex items-center gap-2 border-t border-line pt-4">
            <svg
              aria-hidden
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5 shrink-0"
              fill="none"
              stroke="var(--color-ink-muted)"
              strokeWidth="1.5"
            >
              <rect x="3" y="7" width="10" height="6.5" rx="1" />
              <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
            </svg>
            <span className="text-xs text-ink-muted">Private single-company workspace</span>
          </div>
        </form>
      </div>
    </main>
  )
}