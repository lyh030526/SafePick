import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from './theme';

export type MarketPrice = {
  status: 'far_below' | 'below' | 'typical' | 'insufficient' | 'no_model' | 'no_price' | 'unavailable';
  label: string;
  message: string;
  query: string | null;
  sale_price: string | null;
  median_price: string | null;
  min_price: string | null;
  max_price: string | null;
  ratio_percent: number | null;
  match_count: number;
  listings: { title: string; mall: string; price: string; link: string }[];
};

const tones = {
  typical: 'good', below: 'warn', far_below: 'bad', insufficient: 'neutral', no_model: 'neutral',
  no_price: 'neutral', unavailable: 'neutral',
} as const;

const won = (value: string | null) => value ? `${Number(value).toLocaleString('ko-KR')}원` : '확인 불가';

export function MarketPriceCard({ market }: { market: MarketPrice | null }) {
  if (!market) return null;
  const tone = tones[market.status];
  const rows = [
    ['판매가', market.sale_price ? won(market.sale_price) : null],
    ['시세 중앙값', market.median_price ? won(market.median_price) : null],
    ['시세 범위', market.min_price && market.max_price ? `${won(market.min_price)} ~ ${won(market.max_price)}` : null],
    ['비교한 판매처', market.match_count ? `${market.match_count}곳` : null],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  return <View style={styles.section}>
    <Text style={styles.heading}>가격 시세 비교</Text>
    <View accessibilityLabel={`가격 시세 비교 ${market.label}`} style={styles.card}>
      <View style={[styles.pill, pillStyles[tone]]}>
        <View style={[styles.dot, dotStyles[tone]]} />
        <Text style={[styles.pillText, textStyles[tone]]}>
          {market.ratio_percent !== null ? `시세 중앙값의 ${market.ratio_percent}%` : '같은 모델 시세'}
        </Text>
      </View>
      <Text style={styles.label}>{market.label}</Text>
      <Text style={styles.body}>{market.message}</Text>
      {rows.length ? <View style={styles.rows}>
        {rows.map(([name, value]) => <View key={name} style={styles.row}>
          <Text style={styles.rowLabel}>{name}</Text>
          <Text selectable style={styles.rowValue}>{value}</Text>
        </View>)}
      </View> : null}
      {market.listings.length ? <View style={styles.listings}>
        <Text style={styles.meta}>가장 저렴한 판매처</Text>
        {market.listings.map((item) => <Pressable key={`${item.mall}-${item.price}-${item.title}`} accessibilityRole="link"
          disabled={!item.link} onPress={() => Linking.openURL(item.link)}
          style={({ pressed }) => [styles.listing, pressed && styles.pressed]}>
          <View style={styles.listingText}>
            <Text numberOfLines={1} style={styles.listingTitle}>{item.title}</Text>
            <Text style={styles.meta}>{item.mall}</Text>
          </View>
          <Text style={styles.listingPrice}>{won(item.price)}</Text>
        </Pressable>)}
      </View> : null}
      <Text style={styles.meta}>
        {market.query ? `'${market.query}'로 검색한 ` : ''}Google 쇼핑 결과 중 같은 모델명의 새 상품만 비교했습니다. 옵션·구성·배송비 차이는 반영하지 않으며, 시세 범위라도 정품이나 판매자를 보증하지 않습니다.
      </Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12, marginTop: 8 },
  heading: { color: colors.text, fontSize: 20, fontWeight: '700', lineHeight: 28, marginTop: 12, paddingHorizontal: 4, letterSpacing: -0.4 },
  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: 20, gap: 8 },
  pill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { fontSize: 13, fontWeight: '700' },
  label: { color: colors.text, fontSize: 24, fontWeight: '800', lineHeight: 32, letterSpacing: -0.5, marginTop: 4 },
  body: { color: colors.textSub, fontSize: 15, lineHeight: 23 },
  meta: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  rows: { backgroundColor: colors.fill, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 6, marginTop: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 8 },
  rowLabel: { flexShrink: 0, color: colors.textMuted, fontSize: 14, lineHeight: 21 },
  rowValue: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600', lineHeight: 21, textAlign: 'right' },
  listings: { gap: 4, marginTop: 4 },
  listing: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line },
  listingText: { flex: 1, minWidth: 0 },
  listingTitle: { color: colors.text, fontSize: 14, fontWeight: '600', lineHeight: 21 },
  listingPrice: { flexShrink: 0, color: colors.text, fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.6 },
});

const pillStyles = StyleSheet.create({
  good: { backgroundColor: colors.greenSoft }, warn: { backgroundColor: colors.orangeSoft },
  bad: { backgroundColor: colors.redSoft }, neutral: { backgroundColor: colors.fill },
});
const dotStyles = StyleSheet.create({
  good: { backgroundColor: colors.green }, warn: { backgroundColor: colors.orange },
  bad: { backgroundColor: colors.red }, neutral: { backgroundColor: colors.textFaint },
});
const textStyles = StyleSheet.create({
  good: { color: colors.green }, warn: { color: colors.orangeText },
  bad: { color: colors.red }, neutral: { color: colors.textSub },
});
