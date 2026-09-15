'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';

export default function SignInPage(): React.JSX.Element {
  const { status, signIn, register } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<'signIn' | 'register'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === 'signedIn') router.replace('/connections');
  }, [status, router]);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setBusy(true);
      setError(null);
      try {
        if (mode === 'signIn') await signIn(email.trim(), password);
        else await register(email.trim(), password, displayName.trim());
        router.replace('/connections');
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not reach the server.');
      } finally {
        setBusy(false);
      }
    },
    [mode, email, password, displayName, signIn, register, router],
  );

  const valid =
    email.includes('@') && password.length >= 12 && (mode === 'signIn' || displayName.length > 0);

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold">
          {mode === 'signIn' ? 'Guardian sign in' : 'Create a guardian account'}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          You will be able to see what the people you connect with choose to share, and they can
          see everything you do here.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-3">
          {mode === 'register' && (
            <div>
              <label htmlFor="displayName" className="mb-1 block text-sm text-muted">
                Your name
              </label>
              <input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
                className="w-full rounded-lg border border-line bg-ink-raised px-4 py-3 outline-none focus:border-accent"
              />
            </div>
          )}

          <div>
            <label htmlFor="email" className="mb-1 block text-sm text-muted">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="w-full rounded-lg border border-line bg-ink-raised px-4 py-3 outline-none focus:border-accent"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm text-muted">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
              aria-describedby="password-hint"
              className="w-full rounded-lg border border-line bg-ink-raised px-4 py-3 outline-none focus:border-accent"
            />
            <p id="password-hint" className="mt-1 text-xs text-muted">
              At least 12 characters.
            </p>
          </div>

          {error && (
            <p role="alert" className="text-sm text-live">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!valid || busy}
            className="w-full rounded-lg bg-accent px-4 py-3 font-semibold text-white transition disabled:opacity-40"
          >
            {busy ? 'Working…' : mode === 'signIn' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => setMode(mode === 'signIn' ? 'register' : 'signIn')}
          className="mt-4 w-full py-2 text-sm text-accent"
        >
          {mode === 'signIn' ? 'Need an account? Create one' : 'Already have an account? Sign in'}
        </button>
      </div>
    </main>
  );
}
