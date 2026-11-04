import type { ReactNode } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text } from 'react-native';
import { colors, type } from './theme';
import { TopBar, text } from './ui';

export { Button, Card } from './ui';

// The frame shared by the tab and account screens. A tab screen has a large title; a screen pushed on top of one
// (sign-in, saved listings) also gets a back button.
export function ScreenFrame({ title, back, subtitle, children }: {
  title: string; back?: string; subtitle?: string; children: ReactNode;
}) {
  return <SafeAreaView style={styles.safe}>
    <ScrollView contentContainerStyle={styles.content}>
      {back !== undefined ? <TopBar back={back} /> : null}
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {children}
    </ScrollView>
  </SafeAreaView>;
}

export const frame = StyleSheet.create({
  body: text.body,
  meta: text.small,
  label: text.heading,
  error: text.error,
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32, gap: 12 },
  title: { ...type.display, color: colors.text, marginTop: 4 },
  subtitle: { ...type.body, color: colors.textSub, marginTop: -4, marginBottom: 4 },
});
