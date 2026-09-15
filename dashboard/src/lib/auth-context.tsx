'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { getAccessToken, onAuthChange, restoreSession, setTokens } from './api';
import { authApi } from './endpoints';
import type { AuthUser } from './types';

type Status = 'restoring' | 'signedOut' | 'signedIn';

interface AuthValue {
  status: Status;
  user: AuthUser | null;
  accessToken: string | null;
  signIn(email: string, password: string): Promise<void>;
  register(email: string, password: string, displayName: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [status, setStatus] = useState<Status>('restoring');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ok = await restoreSession();
      if (cancelled) return;
      setAccessToken(getAccessToken());
      setStatus(ok ? 'signedIn' : 'signedOut');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The API layer owns the tokens and rotates them behind our back, and until
  // now nothing subscribed to that. Two consequences, both fixed here:
  //
  //  - A failed refresh (the server revoking a stolen token family) cleared
  //    the tokens but left this provider reporting signedIn with a dead token.
  //    The guardian went on operating a dashboard of last-known data for a
  //    session the server had already killed, with no redirect to sign-in.
  //  - A SUCCESSFUL rotation never reached React state, so the socket effect -
  //    which is keyed on accessToken - never re-ran. After the access token
  //    expired the socket retried forever with the dead one and live
  //    privacy:state updates silently stopped.
  useEffect(
    () =>
      onAuthChange((signedIn) => {
        if (!signedIn) {
          setAccessToken(null);
          setUser(null);
          setStatus('signedOut');
          router.push('/sign-in');
          return;
        }
        setAccessToken(getAccessToken());
      }),
    [router],
  );

  const adopt = useCallback((res: { user: AuthUser; accessToken: string; refreshToken: string }) => {
    setTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
    setAccessToken(res.accessToken);
    setUser(res.user);
    setStatus('signedIn');
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      adopt(await authApi.login(email, password));
    },
    [adopt],
  );

  const register = useCallback(
    async (email: string, password: string, displayName: string) => {
      adopt(await authApi.register(email, password, displayName));
    },
    [adopt],
  );

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Revoking server-side is best effort; clearing locally is not.
    }
    setTokens(null);
    setAccessToken(null);
    setUser(null);
    setStatus('signedOut');
    router.push('/sign-in');
  }, [router]);

  const value = useMemo<AuthValue>(
    () => ({ status, user, accessToken, signIn, register, signOut }),
    [status, user, accessToken, signIn, register, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
