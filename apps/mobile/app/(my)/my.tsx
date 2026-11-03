import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Text, TextInput, StyleSheet, View } from 'react-native';
import { Button, Card, ScreenFrame, frame } from '../../ScreenFrame';
import { deleteAccount, getNickname, setNickname } from '../../lib/account';
import { useSession } from '../../lib/session';
import { colors, radius } from '../../theme';

const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export default function MyPage() {
  const { session, signOut } = useSession();
  const router = useRouter();
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // The stored nickname fills the field only if the shopper has not started typing in it yet.
  useEffect(() => { getNickname().then(stored => setName(current => current || stored)).catch(() => undefined); }, []);
  const provider = session?.user.app_metadata.provider === 'kakao' ? '카카오' : 'Google';

  const remove = async () => {
    setDeleting(true);
    try { await deleteAccount(apiBaseUrl); router.replace('/'); } catch (error) {
      setMessage(error instanceof Error ? error.message : '계정을 삭제하지 못했어요.');
      setDeleting(false);
    }
  };
  return <ScreenFrame title="마이페이지">
    <Card>
      <Text style={frame.label}>{name || '이름 없음'}</Text>
      <Text style={frame.meta}>{provider} 계정으로 로그인했어요{session?.user.email ? ` · ${session.user.email}` : ''}</Text>
    </Card>
    <View style={styles.menu}>
      <Button tone="secondary" label="분석 기록" onPress={() => router.push('/history')} />
      <Button tone="secondary" label="관심 판매처" onPress={() => router.push('/saved')} />
    </View>
    <Card>
      <Text style={frame.label}>계정 설정</Text>
      <Text style={frame.meta}>닉네임</Text>
      <TextInput accessibilityLabel="닉네임" maxLength={40} value={name} onChangeText={setName} style={styles.input} />
      <Button tone="secondary" label="닉네임 저장" onPress={() => setNickname(name)
        .then(() => setMessage('닉네임을 저장했어요.')).catch(() => setMessage('닉네임을 저장하지 못했어요.'))} />
      <Button tone="secondary" label="로그아웃" onPress={() => signOut().then(() => router.replace('/'))} />
      {message ? <Text accessibilityRole="alert" style={frame.meta}>{message}</Text> : null}
    </Card>
    <Card>
      <Text style={frame.label}>회원 탈퇴</Text>
      <Text style={frame.body}>탈퇴하면 분석 기록과 관심 판매처가 모두 바로 삭제되고 되돌릴 수 없어요.</Text>
      {confirming
        ? <View style={styles.menu}>
          <Button tone="danger" disabled={deleting} label={deleting ? '삭제하고 있어요' : '모든 기록을 지우고 탈퇴하기'} onPress={remove} />
          <Button tone="secondary" disabled={deleting} label="취소" onPress={() => setConfirming(false)} />
        </View>
        : <Button tone="danger" label="회원 탈퇴" onPress={() => setConfirming(true)} />}
    </Card>
    {Platform.OS === 'web' ? <Text style={frame.meta}>공용 컴퓨터에서는 사용 후 로그아웃해 주세요.</Text> : null}
  </ScreenFrame>;
}

const styles = StyleSheet.create({
  menu: { gap: 10 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.field, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, color: colors.text, backgroundColor: colors.card },
});
