import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabase, resetSupabaseClient } from '../lib/supabase';

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  authError: string | null;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) {
      setLoading(false);
      return;
    }
    // Never leave the app stuck on "Loading…": the session check must settle
    // even if it rejects or hangs (e.g. flaky mobile network).
    let loadingSettled = false;
    const finishLoading = (u: User | null) => {
      if (loadingSettled) return;
      loadingSettled = true;
      clearTimeout(timer);
      setUser(u);
      setLoading(false);
    };
    const timer = setTimeout(() => finishLoading(null), 10000);
    sb.auth.getSession().then(
      ({ data }) => finishLoading(data.session?.user ?? null),
      () => finishLoading(null),
    );
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      finishLoading(session?.user ?? null);
    });
    return () => {
      clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const sb = getSupabase();
    if (!sb) throw new Error('Backend not configured.');
    setAuthError(null);
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      setAuthError(error.message);
      throw error;
    }
  };

  const signOut = async () => {
    const sb = getSupabase();
    // Clear sensitive application state on sign-out (spec: Authentication and Ownership).
    setUser(null);
    try {
      localStorage.removeItem('mbid.activeBusinessId');
    } catch {
      /* non-critical */
    }
    resetSupabaseClient();
    if (sb) await sb.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, authError }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
