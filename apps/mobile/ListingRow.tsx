import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { marketName } from './browserImport';
import type { ListingSummary } from './lib/account';
import { colors, levels } from './theme';
import { Card, Icon, LevelDot, type IconName, text } from './ui';

// Stored prices are what the page showed ("12900" or "12,900원"); plain numbers read as won.
const won = (price: string | null) => (price && /^\d+$/.test(price) ? `${Number(price).toLocaleString('ko-KR')}원` : price);
const titleOf = (item: ListingSummary) => item.product_name ?? item.page_title ?? item.product_url;
const metaOf = (item: ListingSummary) => [item.seller_name, won(item.price)].filter(Boolean).join(' · ') || item.product_url;

// One analysis or saved listing: its level, seller, price and date, with the reasons on demand.
export function ListingRow({ item, date, reasons, onDelete, deleteLabel }: {
  item: ListingSummary; date: string; reasons?: string[]; onDelete: () => void; deleteLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const level = levels[item.level];
  return <Card style={styles.card}>
    <View accessibilityLabel={`${item.seller_name ?? '판매처'} ${item.label}`} style={styles.head}>
      <LevelDot level={item.level} />
      <View style={styles.headText}>
        {marketName(item.product_url) ? <Text style={styles.market}>{marketName(item.product_url)}</Text> : null}
        <Text numberOfLines={2} style={text.strong}>{titleOf(item)}</Text>
        <Text style={text.small}>{metaOf(item)}</Text>
      </View>
    </View>
    <View style={styles.statusRow}>
      <Text style={[styles.level, { color: level.text }]}>{item.label}{item.score != null ? ` · ${item.score}점` : ''}</Text>
      <Text style={text.small}>{new Date(date).toLocaleDateString('ko-KR')}</Text>
    </View>
    {open ? <View style={styles.detail}>
      {item.summary ? <Text style={text.body}>{item.summary}</Text> : null}
      {(reasons ?? []).map(reason => <Text key={reason} style={text.small}>• {reason}</Text>)}
    </View> : null}
    <View style={styles.actions}>
      {item.summary || reasons?.length ? <Action icon={open ? 'chevron-up' : 'document-text-outline'} label={open ? '접기' : '결과 보기'}
        onPress={() => setOpen(!open)} /> : null}
      <Action icon="open-outline" label="판매 페이지" role="link" onPress={() => Linking.openURL(item.product_url)} />
      <Action icon="trash-outline" label={deleteLabel} danger onPress={onDelete} />
    </View>
  </Card>;
}

// A compact row for the home screen's recent analyses.
export function RecentRow({ item, onPress }: { item: ListingSummary; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.recent, pressed && styles.pressed]}>
    <LevelDot level={item.level} />
    <View style={styles.headText}>
      <Text numberOfLines={1} style={text.strong}>{titleOf(item)}</Text>
      <Text numberOfLines={1} style={text.small}>{[marketName(item.product_url), metaOf(item)].filter(Boolean).join(' · ')}</Text>
    </View>
    <Text style={[styles.level, { color: levels[item.level].text }]}>{item.label}</Text>
  </Pressable>;
}

export function EmptyList({ icon, text: message }: { icon: IconName; text: string }) {
  return <Card style={styles.empty}>
    <Icon name={icon} size={30} color={colors.textFaint} />
    <Text style={[text.body, styles.center]}>{message}</Text>
  </Card>;
}

function Action({ icon, label, onPress, danger = false, role = 'button' }: {
  icon: IconName; label: string; onPress: () => void; danger?: boolean; role?: 'button' | 'link';
}) {
  return <Pressable accessibilityRole={role} onPress={onPress} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
    <Icon name={icon} size={16} color={danger ? colors.red : colors.textSub} />
    <Text style={[styles.actionText, danger && styles.danger]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  head: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  headText: { flex: 1, minWidth: 0, gap: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  level: { fontSize: 14, fontWeight: '700' },
  market: { alignSelf: 'flex-start', color: colors.brandText, backgroundColor: colors.brandSoft, fontSize: 12, fontWeight: '700',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden', marginBottom: 2 },
  detail: { gap: 4, backgroundColor: colors.fill, borderRadius: 12, padding: 12 },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingTop: 10 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: colors.fill },
  actionText: { color: colors.textSub, fontSize: 13, fontWeight: '600' },
  danger: { color: colors.redText },
  pressed: { opacity: 0.7 },
  recent: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  empty: { alignItems: 'center', paddingVertical: 28, gap: 10 },
  center: { textAlign: 'center' },
});
