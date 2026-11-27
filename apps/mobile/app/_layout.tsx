import { Stack, useRootNavigationState, useRouter } from 'expo-router';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { useEffect } from 'react';
import { findLink, isMarketLink, secureMarketLink } from '../browserImport';
import { setPendingLink } from '../lib/pendingCapture';
import { SessionProvider } from '../lib/session';
import { colors } from '../theme';

// A link shared to SafePick from the Coupang, G마켓 or 옥션 app opens in the in-app browser, which reads the product page by itself;
// any other shared link is filled into the analysis screen. In Expo Go and on the web the share module is absent and
// this does nothing.
function SharedLink() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const router = useRouter();
  // A share that launched the app can arrive before the navigator is mounted; it waits until there is one to move.
  const ready = !!useRootNavigationState()?.key;
  useEffect(() => {
    if (!hasShareIntent || !ready) return;
    const link = shareIntent.webUrl || findLink(shareIntent.text ?? '');
    resetShareIntent();
    if (!link) return;
    if (isMarketLink(link)) router.push({ pathname: '/browse', params: { url: secureMarketLink(link) } });
    else { setPendingLink(link); router.navigate('/'); }
  }, [hasShareIntent, ready, shareIntent, resetShareIntent, router]);
  return null;
}

// The tabs (홈·기록·마이) sit underneath; the in-app Coupang browser, saved listings and sign-in open over them.
// Analysis works signed out; the 기록 and 마이 tabs and saved listings ask for a sign-in in place, and the sign-in
// screen sends a signed-in shopper home itself.
export default function RootLayout() {
  return <ShareIntentProvider><SessionProvider>
    <SharedLink />
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="browse" />
      <Stack.Screen name="saved" />
      <Stack.Screen name="ask" />
      <Stack.Screen name="history-chat" />
      <Stack.Screen name="sign-in" />
    </Stack>
  </SessionProvider></ShareIntentProvider>;
}
