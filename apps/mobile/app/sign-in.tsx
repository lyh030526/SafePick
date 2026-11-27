import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ScreenFrame } from '../ScreenFrame';
import { ACCOUNTS_ENABLED, useSession, type Provider } from '../lib/session';
import { colors, radius } from '../theme';
import { Card, Icon, Logo, type IconName, text } from '../ui';

const providers: { id: Provider; label: string }[] = [
  { id: 'kakao', label: '카카오로 시작하기' },
  { id: 'google', label: 'Google로 시작하기' },
];
const perks: { icon: IconName; title: string; body: string }[] = [
  { icon: 'time-outline', title: '분석 기록이 자동으로 쌓여요', body: '쿠팡·G마켓·옥션에서 분석한 결과를 다시 볼 수 있어요' },
  { icon: 'chatbubbles-outline', title: '내 기록에 AI로 물어봐요', body: '“지난번 본 마우스 중 어디가 나았어?”처럼 물으면 기록으로 답해요' },
  { icon: 'bookmark-outline', title: '관심 판매처를 저장해요', body: '사기 전에 한 번 더 확인하고 싶은 곳을 모아 둬요' },
  { icon: 'lock-closed-outline', title: '상품 설명 원문은 저장하지 않아요', body: '판매 페이지 주소와 분석 결과만 내 계정에 남아요' },
];

export default function SignIn() {
  return ACCOUNTS_ENABLED ? <SignInScreen /> : <Redirect href="/" />;
}

function SignInScreen() {
  const { session, signIn, available, loading } = useSession();
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState('');
  if (session) return <Redirect href="/" />;
  const start = async (provider: Provider) => {
    setBusy(provider);
    setError('');
    try { await signIn(provider); } catch (reason) {
      setError(reason instanceof Error ? reason.message : '로그인하지 못했어요. 다시 시도해 주세요.');
    } finally { setBusy(null); }
  };
  return <ScreenFrame title="" back="/">
    <View style={styles.hero}>
      <Logo size={56} />
      <Text style={[text.display, styles.center]}>로그인하고{'\n'}내 분석 기록을 모아 보세요</Text>
      <Text style={[text.body, styles.center, styles.sub]}>로그인하지 않아도 분석은 언제든 할 수 있어요.</Text>
    </View>
    <Card style={styles.perks}>
      {perks.map(perk => <View key={perk.title} style={styles.perk}>
        <View style={styles.perkIcon}><Icon name={perk.icon} size={20} color={colors.brand} /></View>
        <View style={styles.perkText}>
          <Text style={text.strong}>{perk.title}</Text>
          <Text style={text.small}>{perk.body}</Text>
        </View>
      </View>)}
    </Card>
    {loading ? <ActivityIndicator color={colors.brand} /> : null}
    <View style={styles.buttons}>
      {providers.map(provider => <Pressable key={provider.id} accessibilityRole="button" disabled={!available || !!busy}
        onPress={() => start(provider.id)}
        style={({ pressed }) => [styles.button, styles[provider.id], (pressed || !available || !!busy) && styles.dim]}>
        {busy === provider.id ? <ActivityIndicator color={colors.text} />
          : <Icon name={provider.id === 'kakao' ? 'chatbubble' : 'logo-google'} size={19} color={provider.id === 'kakao' ? '#191600' : colors.text} />}
        <Text style={[styles.text, provider.id === 'kakao' ? styles.kakaoText : styles.googleText]}>{provider.label}</Text>
      </Pressable>)}
    </View>
    {!available ? <Text style={text.error}>로그인 설정(Supabase 주소와 키)이 아직 없어 로그인할 수 없어요.</Text> : null}
    {error ? <Text accessibilityRole="alert" style={text.error}>{error}</Text> : null}
    <Text style={[text.small, styles.note]}>카카오는 닉네임·프로필 사진과 동의한 경우 이메일을, Google은 이름과 이메일을 받아요. 마이 화면에서 언제든 탈퇴하면 기록이 모두 지워져요.</Text>
  </ScreenFrame>;
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 12, paddingVertical: 8 },
  center: { textAlign: 'center' },
  sub: { color: colors.textSub },
  perks: { gap: 14 },
  perk: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  perkIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  perkText: { flex: 1, gap: 2 },
  buttons: { gap: 10, marginTop: 4 },
  button: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', borderRadius: radius.button, minHeight: 56 },
  kakao: { backgroundColor: '#FEE500' },
  google: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.line },
  text: { fontSize: 16, fontWeight: '700' },
  kakaoText: { color: 'rgba(0,0,0,0.85)' },
  googleText: { color: colors.text },
  dim: { opacity: 0.6 },
  note: { paddingHorizontal: 4, marginTop: 4, textAlign: 'center' },
});
