import type { Session } from '@supabase/supabase-js';
import { makeRedirectUri } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

export type Provider = 'kakao' | 'google';
type SessionState = {
  session: Session | null;
  loading: boolean;
  available: boolean;
  signIn: (provider: Provider) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

export function useSession() {
  const value = use(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

// Supabase's Kakao provider always adds the email (account_email) to these, so the Kakao app must offer that consent
// item, which Kakao allows only for business apps (an individual developer can convert with identity verification).
// The Supabase Kakao provider should still allow users without an email, for shoppers who decline to share it.
const scopes: Record<Provider, string | undefined> = { kakao: 'profile_nickname profile_image', google: undefined };

async function signIn(provider: Provider) {
  if (!supabase) throw new Error('로그인 설정이 아직 없어요. 관리자에게 문의해 주세요.');
  if (Platform.OS === 'web') {
    // The browser leaves for the provider and comes back here; the client reads the code from the address.
    const { error } = await supabase.auth.signInWithOAuth({
      provider, options: { redirectTo: `${window.location.origin}/sign-in`, scopes: scopes[provider] },
    });
    if (error) throw error;
    return;
  }
  const redirectTo = makeRedirectUri({ path: 'sign-in' });
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider, options: { redirectTo, skipBrowserRedirect: true, scopes: scopes[provider] },
  });
  if (error) throw error;
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return;
  const code = new URL(result.url).searchParams.get('code');
  if (!code) throw new Error('로그인을 마치지 못했어요. 다시 시도해 주세요.');
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) throw exchangeError;
}

// Accounts are switched off for now: no sign-in, history, or saved listings. Turning this on brings them all back.
export const ACCOUNTS_ENABLED = false;
const auth = ACCOUNTS_ENABLED ? supabase : null;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!!auth);
  useEffect(() => {
    if (!supabase || !auth) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);
  const value: SessionState = {
    session, loading, available: !!auth, signIn,
    signOut: async () => { await supabase?.auth.signOut(); },
  };
  return <SessionContext value={value}>{children}</SessionContext>;
}
