import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { parseGroupImport, type BrowserImport } from './browserImport';
import { MarketPriceCard, type MarketPrice } from './MarketPrice';
import { RiskChecklist, type RiskAnalysis } from './RiskChecklist';
import { SellerCheck, type SellerVerification } from './SellerCheck';
import { colors, radius } from './theme';

type Level = 'high' | 'moderate' | 'low' | 'undetermined';
type GroupListing = {
  index: number; rank: number; product_url: string; page_title: string; seller_name: string; seller_kind: string;
  price: number | null; price_percent: number | null; model_number: string; level: Level; label: string;
  score: number | null; summary: string; notes: string[];
  analysis: { risk_analysis: RiskAnalysis; seller_verification: SellerVerification; market_price: MarketPrice };
};
export type GroupResult = { listings: GroupListing[]; median_price: number | null; model_number: string; summary: string;
  warnings: string[] };

const tones = { low: 'good', undetermined: 'neutral', moderate: 'warn', high: 'bad' } as const;
const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;

// The extension writes the list to session storage after this tab loads; it may land before or after the first render.
function readHandoff(onList: (list: BrowserImport[]) => void, onError: (message: string) => void) {
  const read = () => {
    const data = sessionStorage.getItem('safepick-group');
    if (!data) return false;
    sessionStorage.removeItem('safepick-group');
    try { onList(parseGroupImport(data)); } catch (error) { onError(error instanceof Error ? error.message : '비교 목록을 읽지 못했습니다.'); }
    return true;
  };
  if (read()) return () => undefined;
  const listener = () => { read(); };
  window.addEventListener('safepick-group', listener);
  return () => window.removeEventListener('safepick-group', listener);
}

export function GroupComparisonScreen({ apiBaseUrl }: { apiBaseUrl: string }) {
  const [listings, setListings] = useState<BrowserImport[] | null>(null);
  const [result, setResult] = useState<GroupResult | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    window.history.replaceState(null, '', window.location.pathname);
    return readHandoff(setListings, setError);
  }, []);
  useEffect(() => {
    if (!listings) return;
    const controller = new AbortController();
    // Every page runs the full analysis, so ten pages take a few minutes.
    const timer = setTimeout(() => controller.abort(), 600_000);
    fetch(`${apiBaseUrl}/group-analyses`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listings }), signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 429 ? '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.' : '비교 분석에 실패했어요.');
        setResult(await response.json());
      })
      .catch(reason => setError(reason?.name === 'AbortError' ? '비교 시간이 너무 오래 걸려 중단했어요.' : reason?.message || '비교 분석에 실패했어요.'))
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); };
  }, [apiBaseUrl, listings]);

  return <SafeAreaView style={styles.safe}>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>같은 상품 판매 페이지 비교</Text>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
        : !result ? <View style={styles.card}>
          <ActivityIndicator color={colors.brand} />
          <Text style={styles.body}>{listings ? `판매 페이지 ${listings.length}곳을 하나씩 분석하고 있어요. 몇 분 걸릴 수 있어요.` : '확장 프로그램의 비교 목록을 기다리고 있어요.'}</Text>
        </View>
        : <GroupResultView result={result} />}
    </ScrollView>
  </SafeAreaView>;
}

export function GroupResultView({ result }: { result: GroupResult }) {
  const [open, setOpen] = useState<number | null>(null);
  return <View style={styles.list}>
    <View style={styles.card}>
      <Text style={styles.body}>{result.summary}</Text>
      {result.median_price ? <Text style={styles.meta}>판매가 중앙값 {won(result.median_price)}
        {result.model_number !== '확인 불가' ? ` · 모델명 ${result.model_number}` : ''}</Text> : null}
    </View>
    {result.listings.map(item => {
      const tone = tones[item.level];
      const expanded = open === item.index;
      return <View key={item.index} accessibilityLabel={`${item.rank}위 ${item.seller_name} ${item.label}`} style={styles.card}>
        <View style={styles.head}>
          <Text style={styles.rank}>{item.rank}</Text>
          <View style={styles.headText}>
            <Text style={styles.seller} numberOfLines={1}>{item.seller_name}</Text>
            <Text style={styles.meta}>{item.seller_kind}</Text>
          </View>
          <View style={styles.priceBox}>
            <Text style={styles.price}>{item.price ? won(item.price) : '가격 확인 불가'}</Text>
            {item.price_percent != null ? <Text style={[styles.meta,
              ['below', 'far_below'].includes(item.analysis.market_price.status) && styles.cheap]}>
              다른 곳의 {item.price_percent}%</Text> : null}
          </View>
        </View>
        <View style={[styles.pill, pillStyles[tone]]}>
          <Text style={[styles.pillText, textStyles[tone]]}>{item.label}{item.score != null ? ` · ${item.score}점` : ''}</Text>
        </View>
        <Text style={styles.body}>{item.summary}</Text>
        {item.notes.map(note => <Text key={note} style={styles.meta}>· {note}</Text>)}
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={() => setOpen(expanded ? null : item.index)}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
            <Text style={styles.secondaryText}>{expanded ? '접기' : '근거 보기'}</Text>
          </Pressable>
          <Pressable accessibilityRole="link" onPress={() => Linking.openURL(item.product_url)}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
            <Text style={styles.secondaryText}>판매 페이지 열기</Text>
          </Pressable>
        </View>
        {expanded ? <View style={styles.detail}>
          <RiskChecklist analysis={item.analysis.risk_analysis} sourceUrl={item.product_url} />
          <SellerCheck verification={item.analysis.seller_verification} />
          <MarketPriceCard market={item.analysis.market_price} />
        </View> : null}
      </View>;
    })}
    {result.warnings.map(warning => <Text key={warning} style={styles.disclaimer}>{warning}</Text>)}
  </View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 16, gap: 12 },
  title: { color: colors.text, fontSize: 24, fontWeight: '800', lineHeight: 32, letterSpacing: -0.5, marginVertical: 8 },
  list: { gap: 12 },
  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: 18, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rank: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.fill, color: colors.text, fontSize: 15,
    fontWeight: '800', textAlign: 'center', lineHeight: 32 },
  headText: { flex: 1, minWidth: 0 },
  seller: { color: colors.text, fontSize: 17, fontWeight: '700', lineHeight: 24 },
  priceBox: { alignItems: 'flex-end', flexShrink: 0 },
  price: { color: colors.text, fontSize: 17, fontWeight: '800', lineHeight: 24 },
  cheap: { color: colors.red, fontWeight: '700' },
  pill: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  pillText: { fontSize: 13, fontWeight: '700' },
  body: { color: colors.textSub, fontSize: 15, lineHeight: 23 },
  meta: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 },
  secondary: { borderRadius: radius.button, backgroundColor: colors.brandSoft, paddingHorizontal: 14, paddingVertical: 9 },
  secondaryText: { color: colors.brandText, fontSize: 14, fontWeight: '700' },
  detail: { gap: 8, marginTop: 4 },
  error: { color: colors.red, fontSize: 15, lineHeight: 23, backgroundColor: colors.redSoft, borderRadius: radius.card, padding: 16 },
  disclaimer: { color: colors.textMuted, fontSize: 12, lineHeight: 18, paddingHorizontal: 4 },
  pressed: { opacity: 0.6 },
});
const pillStyles = StyleSheet.create({
  good: { backgroundColor: colors.greenSoft }, warn: { backgroundColor: colors.orangeSoft },
  bad: { backgroundColor: colors.redSoft }, neutral: { backgroundColor: colors.fill },
});
const textStyles = StyleSheet.create({
  good: { color: colors.green }, warn: { color: colors.orangeText }, bad: { color: colors.red }, neutral: { color: colors.textSub },
});
