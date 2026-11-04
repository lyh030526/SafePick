import { useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSession } from './lib/session';
import { colors } from './theme';
import { Button, Card, Icon, type IconName, text } from './ui';

// What a signed-in-only screen shows instead: a spinner while the stored session is read, then an invitation to sign in.
export function AccountPrompt({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  const { loading, available } = useSession();
  const router = useRouter();
  if (loading) return <ActivityIndicator style={styles.spinner} color={colors.brand} />;
  return <Card style={styles.card}>
    <View style={styles.badge}><Icon name={icon} size={28} color={colors.brand} /></View>
    <Text style={[text.heading, styles.center]}>{title}</Text>
    <Text style={[text.body, styles.center]}>{body}</Text>
    {available ? <View style={styles.action}><Button label="로그인하기" icon="log-in-outline" onPress={() => router.push('/sign-in')} /></View>
      : <Text style={[text.small, styles.center]}>로그인 설정이 아직 없어 이 기능을 쓸 수 없어요.</Text>}
  </Card>;
}

const styles = StyleSheet.create({
  spinner: { marginTop: 40 },
  card: { alignItems: 'center', paddingVertical: 28, gap: 8 },
  badge: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  center: { textAlign: 'center' },
  action: { alignSelf: 'stretch', marginTop: 10 },
});
