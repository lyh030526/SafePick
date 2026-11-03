import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { isCoupangLink, validCapture } from './browserImport';
import { collectorSource } from './lib/collectorSource';
import { setPendingCapture } from './lib/pendingCapture';
import { colors, radius } from './theme';

// react-native-webview 14 defaults its extra-props parameter to undefined, which collapses the props type to never.
const Web = WebView<object>;

const START = 'https://m.coupang.com/';
const isProduct = (address: string) => {
  try {
    const url = new URL(address);
    return /^(www|m)\.coupang\.com$/.test(url.hostname) && /^\/v[pm]\/products\/\d+\/?$/.test(url.pathname);
  } catch { return false; }
};

// The extension's collector, run inside the page the shopper is looking at; it reads only what that page shows and
// opens the same read-only sections (seller, returns, Q&A, low-star reviews) the extension does.
const inject = `(async () => {
  try {
    ${collectorSource}
    const result = await collectProductPage();
    window.ReactNativeWebView.postMessage(JSON.stringify({ result }));
  } catch (error) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ result: { error: '페이지를 읽지 못했어요. 상품 페이지가 다 뜬 뒤 다시 눌러 주세요.' } }));
  }
})(); true;`;

// Coupang inside the app: the shopper browses as usual and sends the product page they are on to the analysis screen,
// the phone counterpart of the PC extension. Coupang refuses server requests, but this is the shopper's own view.
// Opened with a link (one the shopper copied from the Coupang app), the browser goes straight to that page and reads it
// as soon as the product page has loaded, so nothing has to be searched for again.
export function CoupangBrowser({ initialUrl }: { initialUrl?: string }) {
  const router = useRouter();
  const web = useRef<WebView<object>>(null);
  const [start] = useState(() => initialUrl && isCoupangLink(initialUrl) ? initialUrl : START);
  const autoRead = useRef(start !== START);
  const [address, setAddress] = useState(start);
  const [title, setTitle] = useState('');
  const [canGoBack, setCanGoBack] = useState(false);
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    // Android's back button steps back in the page history before leaving the browser.
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBack) return false;
      web.current?.goBack();
      return true;
    });
    return () => subscription.remove();
  }, [canGoBack]);

  const read = () => {
    setReading(true);
    setMessage('');
    web.current?.injectJavaScript(inject);
  };
  const receive = (event: WebViewMessageEvent) => {
    setReading(false);
    try {
      const { result } = JSON.parse(event.nativeEvent.data);
      if (result?.error) { setMessage(result.error); return; }
      setPendingCapture(validCapture(result));
      router.back();
    } catch {
      setMessage('이 페이지에서는 상품 정보를 가져오지 못했어요. 쿠팡 상품 상세 페이지에서 눌러 주세요.');
    }
  };
  const product = isProduct(address);
  const loaded = (url: string) => {
    if (!autoRead.current || !isProduct(url)) return;
    autoRead.current = false;
    // The seller and return sections fill in after the page itself; give them a moment before reading.
    setReading(true);
    setTimeout(read, 1500);
  };

  return <SafeAreaView style={styles.safe}>
    <View style={styles.bar}>
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.barButton}>
        <Text style={styles.barText}>닫기</Text>
      </Pressable>
      <Text numberOfLines={1} style={styles.title}>{title || '쿠팡'}</Text>
      <Pressable accessibilityRole="button" disabled={!canGoBack} onPress={() => web.current?.goBack()} style={styles.barButton}>
        <Text style={[styles.barText, !canGoBack && styles.dim]}>‹ 이전</Text>
      </Pressable>
    </View>
    <Web ref={web} source={{ uri: start }} style={styles.web} onMessage={receive}
      onLoadEnd={event => loaded(event.nativeEvent.url)}
      // Shared links can try to hand over to the Coupang app (coupang://, intent://); the page stays here instead.
      onShouldStartLoadWithRequest={request => /^https?:/.test(request.url)}
      onNavigationStateChange={state => { setAddress(state.url); setTitle(state.title ?? ''); setCanGoBack(state.canGoBack); setMessage(''); }}
      startInLoadingState renderLoading={() => <ActivityIndicator style={styles.loading} color={colors.blue} />}
      setSupportMultipleWindows={false} allowsBackForwardNavigationGestures />
    <View style={styles.footer}>
      {message ? <Text accessibilityRole="alert" style={styles.error}>{message}</Text>
        : <Text style={styles.hint}>{reading ? '상품 페이지를 읽고 있어요. 잠시만 기다려 주세요.'
          : product ? '이 상품 페이지를 SafePick으로 가져올 수 있어요.' : '분석할 상품을 검색해 상품 페이지를 열어 주세요.'}</Text>}
      <Pressable accessibilityRole="button" disabled={!product || reading} onPress={read}
        style={({ pressed }) => [styles.primary, (!product || reading) && styles.dim, pressed && styles.pressed]}>
        {reading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>이 페이지 분석</Text>}
      </Pressable>
      <Text style={styles.meta}>화면에 보이는 공개 정보만 읽고, 로그인·결제 정보는 읽지 않아요. 분석 전에 내용을 확인하고 동의할 수 있어요.</Text>
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.card },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1,
    borderBottomColor: colors.line },
  barButton: { paddingHorizontal: 8, paddingVertical: 6 },
  barText: { color: colors.blueText, fontSize: 15, fontWeight: '700' },
  title: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  web: { flex: 1 },
  loading: { position: 'absolute', top: '45%', alignSelf: 'center' },
  footer: { padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.card },
  hint: { color: colors.textSub, fontSize: 14, lineHeight: 20 },
  error: { color: colors.red, fontSize: 14, lineHeight: 20 },
  primary: { backgroundColor: colors.blue, borderRadius: radius.button, paddingVertical: 14, alignItems: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  meta: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  dim: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
});
