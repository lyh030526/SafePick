import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

// Both values are public by design: row level security in the database decides what each signed-in user may read.
// Without them the app still analyzes listings; only sign-in and My Page are unavailable.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function storage() {
  if (Platform.OS === 'web') return typeof window === 'undefined' ? undefined : window.localStorage;
  // Expo's guide keeps native sessions in expo-sqlite's localStorage so users stay signed in across launches.
  require('expo-sqlite/localStorage/install');
  return globalThis.localStorage;
}

export const supabase: SupabaseClient | null = url && key ? createClient(url, key, {
  auth: {
    storage: storage(),
    autoRefreshToken: true,
    persistSession: true,
    // The web sign-in returns to this app with a code in the address; native apps exchange it themselves.
    detectSessionInUrl: Platform.OS === 'web',
    flowType: 'pkce',
  },
}) : null;

if (supabase && Platform.OS !== 'web') {
  AppState.addEventListener('change', state => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
