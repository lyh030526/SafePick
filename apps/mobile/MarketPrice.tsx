import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from './theme';
import { Disclosure, Icon, text } from './ui';

export type MarketPrice = {
  status: 'far_below' | 'below' | 'typical' | 'reference' | 'insufficient' | 'no_model' | 'no_price' | 'not_new' | 'unavailable';
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
  option_bait?: boolean;
  option_price?: string | null;
  option_note?: string | null;
  list_inflated?: boolean;
  list_note?: string | null;
  discount_note?: string | null;
};

const tones = {
  typical: 'good', below: 'warn', far_below: 'bad', reference: 'neutral', insufficient: 'neutral', no_model: 'neutral',
  no_price: 'neutral', not_new: 'neutral', unavailable: 'neutral',
} as const;

const won = (value: string | null) => value ? `${Number(value).toLocaleString('ko-KR')}원` : '확인 불가';

export function MarketPriceCard({ market }: { market: MarketPrice | null }) {
  if (!market) return null;
  // A bait price is the finding that matters most here, whatever the market comparison found.
  const tone = market.option_bait || market.list_inflated ? 'warn' : tones[market.status];
  const notes = [market.option_note, market.list_note, market.discount_note].filter((note): note is string => !!note);
  const reference = market.status === 'reference';
  const rows = [
    ['판매가', market.sale_price ? won(market.sale_price) : null],
    [reference ? '참고 가격 중간값' : '시세 중앙값', market.median_price ? won(market.median_price) : null],
    [reference ? '참고 가격 범위' : '시세 범위', market.min_price && market.max_price ? `${won(market.min_price)} ~ ${won(market.max_price)}` : null],
    ['비교한 판매처', market.match_count ? `${market.match_count}곳` : null],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  return <Disclosure accessibilityLabel={`가격 시세 비교 ${market.label}`} title="가격 시세 비교" icon="pricetags-outline"
    status={market.option_bait ? '대표 가격과 옵션 가격 차이' : market.list_inflated ? `${market.label} · 부풀린 정가 의심` : market.ratio_percent !== null ? `${market.label} · ${reference ? '참고 가격' : '시세'}의 ${market.ratio_percent}%` : market.label} tone={tone}>
      {notes.map(note => <View key={note} style={styles.bait}>
        <Icon name="pricetag-outline" size={17} color={colors.orangeText} />
        <Text style={[text.body, styles.flex]}>{note}</Text>
      </View>)}
      <Text style={text.body}>{market.message}</Text>
      {rows.length ? <View style={styles.rows}>
        {rows.map(([name, value]) => <View key={name} style={styles.row}>
          <Text style={styles.rowLabel}>{name}</Text>
          <Text selectable style={styles.rowValue}>{value}</Text>
        </View>)}
      </View> : null}
      {market.listings.length ? <View style={styles.listings}>
        <Text style={text.small}>가장 저렴한 판매처</Text>
        {market.listings.map((item) => <Pressable key={`${item.mall}-${item.price}-${item.title}`} accessibilityRole="link"
          disabled={!item.link} onPress={() => Linking.openURL(item.link)}
          style={({ pressed }) => [styles.listing, pressed && styles.pressed]}>
          <View style={styles.listingText}>
            <Text numberOfLines={1} style={styles.listingTitle}>{item.title}</Text>
            <Text style={text.small}>{item.mall}</Text>
          </View>
          <Text style={styles.listingPrice}>{won(item.price)}</Text>
        </Pressable>)}
      </View> : null}
      <Text style={text.small}>
        {market.query ? `'${market.query}'로 검색한 ` : ''}Google 쇼핑 결과 중 같은 모델명이나 같은 브랜드·상품명의 새 상품만 비교했어요. 옵션·구성·배송비 차이는 반영하지 않으며, 시세 범위라도 정품이나 판매자를 보증하지 않아요.
      </Text>
  </Disclosure>;
}

const styles = StyleSheet.create({
  rows: { backgroundColor: colors.fill, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 8 },
  rowLabel: { flexShrink: 0, color: colors.textMuted, fontSize: 14, lineHeight: 21 },
  rowValue: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600', lineHeight: 21, textAlign: 'right' },
  listings: { gap: 4 },
  listing: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  listingText: { flex: 1, minWidth: 0 },
  listingTitle: { color: colors.text, fontSize: 14, fontWeight: '600', lineHeight: 21 },
  listingPrice: { flexShrink: 0, color: colors.text, fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.6 },
  flex: { flex: 1 },
  bait: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: colors.orangeSoft, borderRadius: 12, padding: 12 },
});
