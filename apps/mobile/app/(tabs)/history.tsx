import { Redirect, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { AskHistoryCard, StatRow } from '../../AccountCards';
import { AccountPrompt } from '../../AccountPrompt';
import { marketName } from '../../browserImport';
import { EmptyList, ListingRow } from '../../ListingRow';
import { ScreenFrame } from '../../ScreenFrame';
import { deleteAnalysis, listAnalyses, type HistoryItem } from '../../lib/account';
import { ACCOUNTS_ENABLED, useSession } from '../../lib/session';
import { colors, radius } from '../../theme';
import { text } from '../../ui';

const reasonsOf = (item: HistoryItem) =>
  ((item.result as { risk_analysis?: { assessment?: { reasons?: string[] } } }).risk_analysis?.assessment?.reasons ?? []);
const markets = ['쿠팡', 'G마켓', '옥션'];

export default function History() {
  return ACCOUNTS_ENABLED ? <HistoryScreen /> : <Redirect href="/" />;
}

function HistoryScreen() {
  const { session } = useSession();
  return <ScreenFrame title="분석 기록">
    {session ? <HistoryList /> : <AccountPrompt icon="time-outline" title="로그인하면 분석 기록이 남아요"
      body="로그인한 상태로 분석한 판매 페이지와 결과가 쌓이고, 그 기록에 AI로 물어볼 수 있어요." />}
  </ScreenFrame>;
}

function HistoryList() {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState('');
  const [market, setMarket] = useState('전체');
  // Reloaded each time the tab is opened, so an analysis made a moment ago is already listed.
  useFocusEffect(useCallback(() => {
    listAnalyses().then(setItems).catch(() => setError('분석 기록을 불러오지 못했어요.'));
  }, []));
  const remove = async (id: string) => {
    try { await deleteAnalysis(id); setItems(current => current?.filter(item => item.id !== id) ?? null); }
    catch { setError('기록을 삭제하지 못했어요.'); }
  };
  const shown = items?.filter(item => market === '전체' || marketName(item.product_url) === market) ?? [];
  const careful = items?.filter(item => item.level === 'high' || item.level === 'moderate').length ?? 0;
  const present = markets.filter(name => items?.some(item => marketName(item.product_url) === name));
  return <>
    {error ? <Text accessibilityRole="alert" style={text.error}>{error}</Text> : null}
    {!items && !error ? <ActivityIndicator color={colors.brand} /> : null}
    {items?.length === 0 ? <EmptyList icon="search-outline" text="아직 분석한 판매 페이지가 없어요. 로그인한 상태로 분석하면 여기에 기록돼요." /> : null}
    {items?.length ? <>
      <AskHistoryCard count={items.length} />
      <StatRow items={[{ label: '전체 기록', value: items.length }, { label: '주의 필요', value: careful, tone: 'warn' },
        { label: '낮음', value: items.filter(item => item.level === 'low').length, tone: 'brand' }]} />
      {present.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {['전체', ...present].map(name => <Pressable key={name} accessibilityRole="button" accessibilityState={{ selected: market === name }}
          onPress={() => setMarket(name)} style={[styles.filter, market === name && styles.filterOn]}>
          <Text style={[styles.filterText, market === name && styles.filterTextOn]}>
            {name} {name === '전체' ? items.length : items.filter(item => marketName(item.product_url) === name).length}
          </Text>
        </Pressable>)}
      </ScrollView> : null}
    </> : null}
    {shown.map(item => <ListingRow key={item.id} item={item} date={item.created_at} reasons={reasonsOf(item)}
      deleteLabel="기록 삭제" onDelete={() => remove(item.id)} />)}
    {items?.length ? <Text style={text.small}>최근 100개까지 보여요. 결과는 분석한 날 기준이라, 지금 판매 페이지는 달라졌을 수 있어요.</Text> : null}
  </>;
}

const styles = StyleSheet.create({
  filters: { gap: 8, paddingVertical: 2 },
  filter: { borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  filterOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  filterText: { color: colors.textSub, fontSize: 14, fontWeight: '700' },
  filterTextOn: { color: '#F4F7F6' },
});
