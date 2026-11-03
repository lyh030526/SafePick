import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ListingSummary } from './lib/account';
import { colors, radius } from './theme';

const tones = { low: 'good', undetermined: 'neutral', moderate: 'warn', high: 'bad' } as const;
// Stored prices are what the page showed ("12900" or "12,900원"); plain numbers read as won.
const won = (price: string | null) => (price && /^\d+$/.test(price) ? `${Number(price).toLocaleString('ko-KR')}원` : price);

// One analysis or saved listing: its level, seller, price and date, with the reasons on demand.
export function ListingRow({ item, date, reasons, onDelete, deleteLabel }: {
  item: ListingSummary; date: string; reasons?: string[]; onDelete: () => void; deleteLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const tone = tones[item.level];
  return <View accessibilityLabel={`${item.seller_name ?? '판매처'} ${item.label}`} style={styles.card}>
    <View style={styles.head}>
      <View style={[styles.pill, pillStyles[tone]]}>
        <Text style={[styles.pillText, textStyles[tone]]}>{item.label}{item.score != null ? ` · ${item.score}점` : ''}</Text>
      </View>
      <Text style={styles.date}>{new Date(date).toLocaleDateString('ko-KR')}</Text>
    </View>
    <Text numberOfLines={2} style={styles.title}>{item.product_name ?? item.page_title ?? item.product_url}</Text>
    <Text style={styles.meta}>{[item.seller_name, won(item.price)].filter(Boolean).join(' · ') || item.product_url}</Text>
    {open ? <View style={styles.detail}>
      {item.summary ? <Text style={styles.body}>{item.summary}</Text> : null}
      {(reasons ?? []).map(reason => <Text key={reason} style={styles.meta}>• {reason}</Text>)}
    </View> : null}
    <View style={styles.actions}>
      {item.summary || reasons?.length ? <Pressable accessibilityRole="button" onPress={() => setOpen(!open)} style={styles.action}>
        <Text style={styles.actionText}>{open ? '접기' : '결과 보기'}</Text>
      </Pressable> : null}
      <Pressable accessibilityRole="link" onPress={() => Linking.openURL(item.product_url)} style={styles.action}>
        <Text style={styles.actionText}>판매 페이지</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onDelete} style={styles.action}>
        <Text style={[styles.actionText, styles.danger]}>{deleteLabel}</Text>
      </Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: 16, gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pill: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: 13, fontWeight: '700' },
  date: { color: colors.textMuted, fontSize: 13 },
  title: { color: colors.text, fontSize: 16, fontWeight: '700', lineHeight: 23 },
  meta: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  body: { color: colors.textSub, fontSize: 14, lineHeight: 21 },
  detail: { gap: 4, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 16, flexWrap: 'wrap', marginTop: 4 },
  action: { paddingVertical: 4 },
  actionText: { color: colors.blueText, fontSize: 14, fontWeight: '700' },
  danger: { color: colors.red },
});
const pillStyles = StyleSheet.create({
  good: { backgroundColor: colors.greenSoft }, warn: { backgroundColor: colors.orangeSoft },
  bad: { backgroundColor: colors.redSoft }, neutral: { backgroundColor: colors.fill },
});
const textStyles = StyleSheet.create({
  good: { color: colors.green }, warn: { color: colors.orangeText }, bad: { color: colors.red }, neutral: { color: colors.textSub },
});
