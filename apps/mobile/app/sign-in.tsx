import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, ScreenFrame, frame } from '../ScreenFrame';
import { useSession, type Provider } from '../lib/session';
import { colors, radius } from '../theme';

const providers: { id: Provider; label: string }[] = [
  { id: 'kakao', label: '카카오로 시작하기' },
  { id: 'google', label: 'Google로 시작하기' },
];

export default function SignIn() {
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
  return <ScreenFrame title="로그인">
    <Card>
      <Text style={frame.body}>로그인하면 분석한 판매 페이지가 기록되고, 관심 판매처를 저장해 다시 확인할 수 있어요. 로그인하지 않아도 분석은 할 수 있어요.</Text>
      {loading ? <ActivityIndicator color={colors.blue} /> : null}
      <View style={styles.buttons}>
        {providers.map(provider => <Pressable key={provider.id} accessibilityRole="button" disabled={!available || !!busy}
          onPress={() => start(provider.id)}
          style={({ pressed }) => [styles.button, styles[provider.id], (pressed || !available || !!busy) && styles.dim]}>
          {busy === provider.id ? <ActivityIndicator color={colors.text} /> : null}
          <Text style={[styles.text, provider.id === 'kakao' ? styles.kakaoText : styles.googleText]}>{provider.label}</Text>
        </Pressable>)}
      </View>
      {!available ? <Text style={frame.error}>로그인 설정(Supabase 주소와 키)이 아직 없어 로그인할 수 없어요.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={frame.error}>{error}</Text> : null}
      <Text style={frame.meta}>카카오는 닉네임·프로필 사진과 동의한 경우 이메일을, Google은 이름과 이메일을 받아요. 분석 기록에는 판매 페이지 주소와 결과만 저장하고, 가져온 상품 설명 원문은 저장하지 않아요.</Text>
    </Card>
  </ScreenFrame>;
}

const styles = StyleSheet.create({
  buttons: { gap: 10, marginVertical: 6 },
  button: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', borderRadius: radius.button, paddingVertical: 14 },
  kakao: { backgroundColor: '#FEE500' },
  google: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.line },
  text: { fontSize: 16, fontWeight: '700' },
  kakaoText: { color: 'rgba(0,0,0,0.85)' },
  googleText: { color: colors.text },
  dim: { opacity: 0.6 },
});
