import { Stack, useRootNavigationState, useRouter } from 'expo-router';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { useEffect } from 'react';
import { findLink, isCoupangLink } from '../browserImport';
import { setPendingLink } from '../lib/pendingCapture';
import { SessionProvider, useSession } from '../lib/session';

// A link shared to SafePick from the Coupang app opens in the in-app browser, which reads the product page by itself;
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
    if (isCoupangLink(link)) router.push({ pathname: '/browse', params: { url: link } });
    else { setPendingLink(link); router.navigate('/'); }
  }, [hasShareIntent, ready, shareIntent, resetShareIntent, router]);
  return null;
}

// Analysis works signed out; My Page and its lists need a session, and the sign-in screen is only for signed-out users.
// The router must render from the first frame or it loses the address it opened at, so while the stored session is
// still being read neither guard closes: a reload of /my stays on /my, and is sent home only once it is known that
// nobody is signed in. The sign-in screen sends a signed-in shopper home itself: a guard closing on it would land on
// the bare (my) group, which has no screen of its own.
function RootNavigator() {
  const { session, loading } = useSession();
  return (
    <>
      <SharedLink />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="browse" />
        <Stack.Protected guard={loading || !!session}>
          <Stack.Screen name="(my)" />
        </Stack.Protected>
        <Stack.Screen name="sign-in" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return <ShareIntentProvider><SessionProvider><RootNavigator /></SessionProvider></ShareIntentProvider>;
}
