import { useEffect, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { ListingRow } from '../../ListingRow';
import { Card, ScreenFrame, frame } from '../../ScreenFrame';
import { deleteAnalysis, listAnalyses, type HistoryItem } from '../../lib/account';
import { colors } from '../../theme';

const reasonsOf = (item: HistoryItem) =>
  ((item.result as { risk_analysis?: { assessment?: { reasons?: string[] } } }).risk_analysis?.assessment?.reasons ?? []);

export default function History() {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { listAnalyses().then(setItems).catch(() => setError('분석 기록을 불러오지 못했어요.')); }, []);
  const remove = async (id: string) => {
    try { await deleteAnalysis(id); setItems(current => current?.filter(item => item.id !== id) ?? null); }
    catch { setError('기록을 삭제하지 못했어요.'); }
  };
  return <ScreenFrame title="분석 기록" back="/my">
    {error ? <Text accessibilityRole="alert" style={frame.error}>{error}</Text> : null}
    {!items && !error ? <ActivityIndicator color={colors.blue} /> : null}
    {items?.length === 0 ? <Card><Text style={frame.body}>아직 분석한 판매 페이지가 없어요. 로그인한 상태로 분석하면 여기에 기록돼요.</Text></Card> : null}
    {items?.map(item => <ListingRow key={item.id} item={item} date={item.created_at} reasons={reasonsOf(item)}
      deleteLabel="기록 삭제" onDelete={() => remove(item.id)} />)}
    {items?.length ? <Text style={frame.meta}>최근 100개까지 보여요. 결과는 분석한 날 기준이라, 지금 판매 페이지는 달라졌을 수 있어요.</Text> : null}
  </ScreenFrame>;
}
