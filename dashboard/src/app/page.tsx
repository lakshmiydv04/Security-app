'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export default function Home(): React.JSX.Element {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'signedIn') router.replace('/connections');
    else if (status === 'signedOut') router.replace('/sign-in');
  }, [status, router]);

  return (
    <main className="grid min-h-screen place-items-center">
      <p className="text-muted">Loading…</p>
    </main>
  );
}
