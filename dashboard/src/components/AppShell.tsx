'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export function AppShell({
  children,
  connected,
}: {
  children: React.ReactNode;
  connected?: boolean;
}): React.JSX.Element | null {
  const { status, user, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'signedOut') router.replace('/sign-in');
  }, [status, router]);

  if (status !== 'signedIn') {
    return (
      <main className="grid min-h-screen place-items-center">
        <p className="text-muted">Loading…</p>
      </main>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-ink/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link href="/connections" className="font-bold">
            Guardian
          </Link>

          {connected !== undefined && (
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <span
                aria-hidden
                className={`inline-block h-2 w-2 rounded-full ${
                  connected ? 'bg-shield' : 'bg-locked'
                }`}
              />
              {/* Stated in words too: a colour-only status is invisible to
                  a chunk of users and unreadable to a screen reader. */}
              {connected ? 'Live' : 'Reconnecting…'}
            </span>
          )}

          <div className="ml-auto flex items-center gap-3 text-sm">
            {user && <span className="text-muted">{user.displayName}</span>}
            <button onClick={() => void signOut()} className="text-accent hover:underline">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
