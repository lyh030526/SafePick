import { useEffect, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { ListingRow } from '../../ListingRow';
import { Card, ScreenFrame, frame } from '../../ScreenFrame';
import { listSaved, removeSaved, type SavedItem } from '../../lib/account';
import { colors } from '../../theme';

export default function Saved() {
  const [items, setItems] = useState<SavedItem[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { listSaved().then(setItems).catch(() => setError('관심 판매처를 불러오지 못했어요.')); }, []);
  const remove = async (id: string) => {
    try { await removeSaved(id); setItems(current => current?.filter(item => item.id !== id) ?? null); }
    catch { setError('관심 판매처를 삭제하지 못했어요.'); }
  };
  return <ScreenFrame title="관심 판매처" back="/my">
    {error ? <Text accessibilityRole="alert" style={frame.error}>{error}</Text> : null}
    {!items && !error ? <ActivityIndicator color={colors.blue} /> : null}
    {items?.length === 0 ? <Card><Text style={frame.body}>저장한 판매처가 없어요. 분석 결과 화면의 &apos;관심 판매처로 저장&apos;을 눌러 보세요.</Text></Card> : null}
    {items?.map(item => <ListingRow key={item.id} item={item} date={item.created_at} deleteLabel="저장 취소"
      onDelete={() => remove(item.id)} />)}
    {items?.length ? <Text style={frame.meta}>저장할 때의 결과예요. 구매 전에 판매 페이지를 다시 분석해 보세요.</Text> : null}
  </ScreenFrame>;
}
