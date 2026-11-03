import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from './theme';

// The frame shared by the sign-in and My Page screens: a back link, a title, and a centered column of cards.
export function ScreenFrame({ title, back = '/', children }: { title: string; back?: string; children: ReactNode }) {
  const router = useRouter();
  return <SafeAreaView style={styles.safe}>
    <ScrollView contentContainerStyle={styles.content}>
      <Pressable accessibilityRole="link" onPress={() => (router.canGoBack() ? router.back() : router.replace(back))}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
        <Text style={styles.backText}>‹ 뒤로</Text>
      </Pressable>
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      {children}
    </ScrollView>
  </SafeAreaView>;
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function Button({ label, onPress, tone = 'primary', disabled = false }: {
  label: string; onPress: () => void; tone?: 'primary' | 'secondary' | 'danger'; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, buttonStyles[tone], (pressed || disabled) && styles.pressed]}>
    <Text style={[styles.buttonText, buttonText[tone]]}>{label}</Text>
  </Pressable>;
}

export const frame = StyleSheet.create({
  body: { color: colors.textSub, fontSize: 15, lineHeight: 23 },
  meta: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  label: { color: colors.text, fontSize: 16, fontWeight: '700', lineHeight: 23 },
  error: { color: colors.red, fontSize: 14, lineHeight: 21 },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 16, gap: 12 },
  back: { alignSelf: 'flex-start', paddingVertical: 6 },
  backText: { color: colors.blueText, fontSize: 15, fontWeight: '700' },
  title: { color: colors.text, fontSize: 24, fontWeight: '800', lineHeight: 32, letterSpacing: -0.5, marginBottom: 4 },
  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: 18, gap: 8 },
  button: { borderRadius: radius.button, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center' },
  buttonText: { fontSize: 16, fontWeight: '700' },
  pressed: { opacity: 0.6 },
});
const buttonStyles = StyleSheet.create({
  primary: { backgroundColor: colors.blue }, secondary: { backgroundColor: colors.blueSoft }, danger: { backgroundColor: colors.redSoft },
});
const buttonText = StyleSheet.create({
  primary: { color: '#FFFFFF' }, secondary: { color: colors.blueText }, danger: { color: colors.red },
});
