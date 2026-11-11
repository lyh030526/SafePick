import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ScreenFrame } from '../ScreenFrame';
import { ACCOUNTS_ENABLED, useSession, type Provider } from '../lib/session';
import { colors, radius } from '../theme';
import { Card, Icon, type IconName, text } from '../ui';

const providers: { id: Provider; label: string }[] = [
  { id: 'kakao', label: '카카오로 시작하기' },
  { id: 'google', label: 'Google로 시작하기' },
];
const perks: { icon: IconName; label: string }[] = [
  { icon: 'time-outline', label: '분석한 판매 페이지가 자동으로 기록돼요' },
  { icon: 'bookmark-outline', label: '관심 판매처를 저장해 다시 확인할 수 있어요' },
  { icon: 'lock-closed-outline', label: '상품 설명 원문은 저장하지 않아요' },
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
  return <ScreenFrame title="로그인" back="/" subtitle="로그인하지 않아도 분석은 할 수 있어요.">
    <Card>
      {perks.map(perk => <View key={perk.label} style={styles.perk}>
        <View style={styles.perkIcon}><Icon name={perk.icon} size={18} color={colors.brand} /></View>
        <Text style={[text.strong, styles.perkText]}>{perk.label}</Text>
      </View>)}
    </Card>
    {loading ? <ActivityIndicator color={colors.brand} /> : null}
    <View style={styles.buttons}>
      {providers.map(provider => <Pressable key={provider.id} accessibilityRole="button" disabled={!available || !!busy}
        onPress={() => start(provider.id)}
        style={({ pressed }) => [styles.button, styles[provider.id], (pressed || !available || !!busy) && styles.dim]}>
        {busy === provider.id ? <ActivityIndicator color={colors.text} />
          : <Icon name={provider.id === 'kakao' ? 'chatbubble' : 'logo-google'} size={18} color={provider.id === 'kakao' ? '#191600' : colors.text} />}
        <Text style={[styles.text, provider.id === 'kakao' ? styles.kakaoText : styles.googleText]}>{provider.label}</Text>
      </Pressable>)}
    </View>
    {!available ? <Text style={text.error}>로그인 설정(Supabase 주소와 키)이 아직 없어 로그인할 수 없어요.</Text> : null}
    {error ? <Text accessibilityRole="alert" style={text.error}>{error}</Text> : null}
    <Text style={[text.small, styles.note]}>카카오는 닉네임·프로필 사진과 동의한 경우 이메일을, Google은 이름과 이메일을 받아요. 분석 기록에는 판매 페이지 주소와 결과만 저장해요.</Text>
  </ScreenFrame>;
}

const styles = StyleSheet.create({
  perk: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  perkIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  perkText: { flex: 1 },
  buttons: { gap: 10, marginTop: 8 },
  button: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', borderRadius: radius.button, minHeight: 54 },
  kakao: { backgroundColor: '#FEE500' },
  google: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.line },
  text: { fontSize: 16, fontWeight: '700' },
  kakaoText: { color: 'rgba(0,0,0,0.85)' },
  googleText: { color: colors.text },
  dim: { opacity: 0.6 },
  note: { paddingHorizontal: 4, marginTop: 4 },
});
