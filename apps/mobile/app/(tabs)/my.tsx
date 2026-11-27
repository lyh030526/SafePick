import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { AskHistoryCard } from '../../AccountCards';
import { AccountPrompt } from '../../AccountPrompt';
import { ScreenFrame } from '../../ScreenFrame';
import { deleteAccount, getNickname, listAnalyses, listSaved, setNickname } from '../../lib/account';
import { ACCOUNTS_ENABLED, useSession } from '../../lib/session';
import { colors, radius } from '../../theme';
import { Button, Card, Divider, ListRow, SectionTitle, text } from '../../ui';

const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export default function MyPage() {
  return ACCOUNTS_ENABLED ? <MyPageScreen /> : <Redirect href="/" />;
}

function MyPageScreen() {
  const { session } = useSession();
  return <ScreenFrame title="마이">
    {session ? <Account /> : <AccountPrompt icon="person-circle-outline" title="로그인하고 내 기록을 모아 보세요"
      body="분석한 판매 페이지가 자동으로 기록되고, 그 기록에 AI로 물어보거나 관심 판매처를 저장할 수 있어요." />}
  </ScreenFrame>;
}

function Account() {
  const { session, signOut } = useSession();
  const router = useRouter();
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [counts, setCounts] = useState<{ analyses: number | null; saved: number | null }>({ analyses: null, saved: null });
  // The stored nickname fills the field only if the shopper has not started typing in it yet.
  useEffect(() => { getNickname().then(stored => setName(current => current || stored)).catch(() => undefined); }, []);
  useFocusEffect(useCallback(() => {
    Promise.all([listAnalyses().catch(() => null), listSaved().catch(() => null)])
      .then(([analyses, saved]) => setCounts({ analyses: analyses?.length ?? null, saved: saved?.length ?? null }));
  }, []));
  const provider = session?.user.app_metadata.provider === 'kakao' ? '카카오' : 'Google';
  const initial = (name || provider).slice(0, 1);

  const remove = async () => {
    setDeleting(true);
    try { await deleteAccount(apiBaseUrl); router.replace('/'); } catch (error) {
      setMessage(error instanceof Error ? error.message : '계정을 삭제하지 못했어요.');
      setDeleting(false);
    }
  };
  return <>
    <View style={styles.profile}>
      <View style={styles.profileHead}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initial}</Text></View>
        <View style={styles.profileText}>
          <Text style={styles.name}>{name || '이름 없음'}</Text>
          <Text numberOfLines={1} style={styles.account}>{provider} 계정{session?.user.email ? ` · ${session.user.email}` : ''}</Text>
        </View>
      </View>
      <View style={styles.counts}>
        <View style={styles.count}><Text style={styles.countValue}>{counts.analyses ?? '–'}</Text><Text style={styles.countLabel}>분석 기록</Text></View>
        <View style={styles.countDivider} />
        <View style={styles.count}><Text style={styles.countValue}>{counts.saved ?? '–'}</Text><Text style={styles.countLabel}>관심 판매처</Text></View>
      </View>
    </View>

    <AskHistoryCard count={counts.analyses ?? undefined} />

    <Card tight>
      <ListRow icon="time-outline" title="분석 기록" subtitle="로그인한 뒤 분석한 판매 페이지" onPress={() => router.push('/history')} />
      <Divider />
      <ListRow icon="bookmark-outline" title="관심 판매처" subtitle="저장해 둔 판매 페이지" onPress={() => router.push('/saved')} />
    </Card>

    <SectionTitle>계정 설정</SectionTitle>
    <Card>
      <Text style={text.strong}>닉네임</Text>
      <View style={styles.nicknameRow}>
        <TextInput accessibilityLabel="닉네임" maxLength={40} value={name} onChangeText={setName} style={styles.input}
          placeholder="닉네임" placeholderTextColor={colors.textFaint} />
        <Button tone="secondary" label="저장" onPress={() => setNickname(name)
          .then(() => setMessage('닉네임을 저장했어요.')).catch(() => setMessage('닉네임을 저장하지 못했어요.'))} />
      </View>
      {message ? <Text accessibilityRole="alert" style={text.small}>{message}</Text> : null}
    </Card>
    <Card tight>
      <ListRow icon="log-out-outline" title="로그아웃" onPress={() => signOut().then(() => router.replace('/'))} />
      <Divider />
      <ListRow icon="trash-outline" title="회원 탈퇴" danger onPress={() => setConfirming(true)} />
    </Card>
    {confirming ? <Card style={styles.danger}>
      <Text style={text.heading}>정말 탈퇴할까요?</Text>
      <Text style={text.body}>분석 기록과 관심 판매처가 모두 바로 삭제되고 되돌릴 수 없어요.</Text>
      <Button tone="danger" busy={deleting} label={deleting ? '삭제하고 있어요' : '모든 기록을 지우고 탈퇴하기'} onPress={remove} />
      <Button tone="ghost" disabled={deleting} label="취소" onPress={() => setConfirming(false)} />
    </Card> : null}
    {Platform.OS === 'web' ? <Text style={[text.small, styles.note]}>공용 컴퓨터에서는 사용 후 로그아웃해 주세요.</Text> : null}
  </>;
}

const styles = StyleSheet.create({
  profile: { backgroundColor: colors.card, borderRadius: radius.card, padding: 18, gap: 16, borderWidth: 1, borderColor: colors.line },
  profileHead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontSize: 24, fontWeight: '800' },
  profileText: { flex: 1, minWidth: 0, gap: 2 },
  name: { color: colors.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
  account: { color: colors.textMuted, fontSize: 13 },
  counts: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.fill, borderRadius: 16, paddingVertical: 12 },
  count: { flex: 1, alignItems: 'center', gap: 2 },
  countValue: { color: colors.text, fontSize: 22, fontWeight: '800' },
  countLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  countDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.line },
  nicknameRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, minWidth: 0, borderRadius: radius.field, paddingHorizontal: 14, minHeight: 52, fontSize: 16,
    color: colors.text, backgroundColor: colors.fill },
  danger: { borderWidth: 1, borderColor: colors.redSoft },
  note: { paddingHorizontal: 4 },
});
