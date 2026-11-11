import { Redirect, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { AccountPrompt } from '../../AccountPrompt';
import { EmptyList, ListingRow } from '../../ListingRow';
import { ScreenFrame } from '../../ScreenFrame';
import { deleteAnalysis, listAnalyses, type HistoryItem } from '../../lib/account';
import { ACCOUNTS_ENABLED, useSession } from '../../lib/session';
import { colors } from '../../theme';
import { text } from '../../ui';

const reasonsOf = (item: HistoryItem) =>
  ((item.result as { risk_analysis?: { assessment?: { reasons?: string[] } } }).risk_analysis?.assessment?.reasons ?? []);

export default function History() {
  return ACCOUNTS_ENABLED ? <HistoryScreen /> : <Redirect href="/" />;
}

function HistoryScreen() {
  const { session } = useSession();
  return <ScreenFrame title="분석 기록">
    {session ? <HistoryList /> : <AccountPrompt icon="time-outline" title="로그인하면 분석 기록이 남아요"
      body="로그인한 상태로 분석한 판매 페이지와 결과를 여기서 다시 볼 수 있어요." />}
  </ScreenFrame>;
}

function HistoryList() {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState('');
  // Reloaded each time the tab is opened, so an analysis made a moment ago is already listed.
  useFocusEffect(useCallback(() => {
    listAnalyses().then(setItems).catch(() => setError('분석 기록을 불러오지 못했어요.'));
  }, []));
  const remove = async (id: string) => {
    try { await deleteAnalysis(id); setItems(current => current?.filter(item => item.id !== id) ?? null); }
    catch { setError('기록을 삭제하지 못했어요.'); }
  };
  return <>
    {error ? <Text accessibilityRole="alert" style={text.error}>{error}</Text> : null}
    {!items && !error ? <ActivityIndicator color={colors.brand} /> : null}
    {items?.length === 0 ? <EmptyList icon="search-outline" text="아직 분석한 판매 페이지가 없어요. 로그인한 상태로 분석하면 여기에 기록돼요." /> : null}
    {items?.map(item => <ListingRow key={item.id} item={item} date={item.created_at} reasons={reasonsOf(item)}
      deleteLabel="기록 삭제" onDelete={() => remove(item.id)} />)}
    {items?.length ? <Text style={text.small}>최근 100개까지 보여요. 결과는 분석한 날 기준이라, 지금 판매 페이지는 달라졌을 수 있어요.</Text> : null}
  </>;
}
