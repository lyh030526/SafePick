import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { AccountPrompt } from '../AccountPrompt';
import { EmptyList, ListingRow } from '../ListingRow';
import { ScreenFrame } from '../ScreenFrame';
import { listSaved, removeSaved, type SavedItem } from '../lib/account';
import { ACCOUNTS_ENABLED, useSession } from '../lib/session';
import { colors } from '../theme';
import { text } from '../ui';

export default function Saved() {
  return ACCOUNTS_ENABLED ? <SavedScreen /> : <Redirect href="/" />;
}

function SavedScreen() {
  const { session } = useSession();
  return <ScreenFrame title="관심 판매처" back="/my">
    {session ? <SavedList /> : <AccountPrompt icon="bookmark-outline" title="로그인하고 판매처를 저장하세요"
      body="분석 결과에서 저장한 판매처를 여기서 모아 볼 수 있어요." />}
  </ScreenFrame>;
}

function SavedList() {
  const [items, setItems] = useState<SavedItem[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { listSaved().then(setItems).catch(() => setError('관심 판매처를 불러오지 못했어요.')); }, []);
  const remove = async (id: string) => {
    try { await removeSaved(id); setItems(current => current?.filter(item => item.id !== id) ?? null); }
    catch { setError('관심 판매처를 삭제하지 못했어요.'); }
  };
  return <>
    {error ? <Text accessibilityRole="alert" style={text.error}>{error}</Text> : null}
    {!items && !error ? <ActivityIndicator color={colors.brand} /> : null}
    {items?.length === 0 ? <EmptyList icon="bookmark-outline" text="저장한 판매처가 없어요. 분석 결과 화면에서 '관심 판매처로 저장'을 눌러 보세요." /> : null}
    {items?.map(item => <ListingRow key={item.id} item={item} date={item.created_at} deleteLabel="저장 취소"
      onDelete={() => remove(item.id)} />)}
    {items?.length ? <Text style={text.small}>저장할 때의 결과예요. 구매 전에 판매 페이지를 다시 분석해 보세요.</Text> : null}
  </>;
}
