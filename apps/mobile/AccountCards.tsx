import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from './theme';
import { Icon } from './ui';

// The way into questions about the saved analyses, on the history and my-page screens.
export function AskHistoryCard({ count }: { count?: number }) {
  const router = useRouter();
  return <Pressable accessibilityRole="button" accessibilityLabel="내 분석 기록에 AI로 물어보기" onPress={() => router.push('/history-chat')}
    style={({ pressed }) => [styles.ask, pressed && styles.pressed]}>
    <View style={styles.askIcon}><Icon name="chatbubbles" size={22} color={colors.ink} /></View>
    <View style={styles.askText}>
      <Text style={styles.askTitle}>내 분석 기록에 AI로 물어보기</Text>
      <Text style={styles.askSub}>{count ? `기록 ${count}개 중 관련된 것을 찾아 ` : ''}근거를 달아 답해요</Text>
    </View>
    <Icon name="chevron-forward" size={20} color="#9FD9C8" />
  </Pressable>;
}

// Small figures at the top of a list: how many and how many needed care.
export function StatRow({ items }: { items: { label: string; value: number | string; tone?: 'brand' | 'warn' | 'plain' }[] }) {
  return <View style={styles.stats}>
    {items.map(item => <View key={item.label} style={styles.stat}>
      <Text style={[styles.statValue, item.tone === 'warn' && { color: colors.orangeText }, item.tone === 'brand' && { color: colors.brandText }]}>
        {item.value}</Text>
      <Text style={styles.statLabel}>{item.label}</Text>
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.85 },
  ask: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.ink, borderRadius: radius.card, padding: 16 },
  askIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#9FD9C8', alignItems: 'center', justifyContent: 'center' },
  askText: { flex: 1, minWidth: 0, gap: 2 },
  askTitle: { color: '#F4F7F6', fontSize: 16, fontWeight: '800' },
  askSub: { color: '#BFD8D5', fontSize: 13 },
  stats: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, backgroundColor: colors.card, borderRadius: 16, paddingVertical: 12, alignItems: 'center', gap: 2 },
  statValue: { color: colors.text, fontSize: 22, fontWeight: '800' },
  statLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
});
