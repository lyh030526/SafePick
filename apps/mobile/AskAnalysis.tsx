import { useRouter } from 'expo-router';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { colors, radius, shadow } from './theme';
import { Icon, TopBar, text } from './ui';

const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';
const suggestions = ['이 판매자 믿어도 될까?', '구매 전에 꼭 확인할 건 뭐야?', '반품은 어떻게 해야 해?'];

type Answer = { question: string; answer: string; citations: { id: string; text: string }[]; failed?: boolean };

// The result the chat answers about, and what was asked so far. Kept in memory only, so going back to the result and
// returning keeps the conversation; a new analysis starts a new one.
let current: { key: string; analysis: Record<string, unknown>; title: string; answers: Answer[] } | null = null;

// On the result screen: a round chat button floating at the bottom right that opens the chat for this result.
export function AskAnalysis({ analysis, title }: { analysis: Record<string, unknown>; title?: string }) {
  const router = useRouter();
  const open = () => {
    // The result screen builds the object on every render, so the same result is recognised by its content.
    const key = JSON.stringify(analysis);
    if (current?.key !== key) current = { key, analysis, title: title ?? '', answers: [] };
    router.push('/ask');
  };
  return <Pressable accessibilityRole="button" accessibilityLabel="AI에게 결과 물어보기" onPress={open} hitSlop={6}
    style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}>
    <Icon name="chatbubble-ellipses" size={28} color="#FFFFFF" />
  </Pressable>;
}

// The chat screen: questions about the one result, answered only from its own findings, with the findings each answer
// used one tap away.
export function AskChat() {
  const router = useRouter();
  const [answers, setAnswers] = useState<Answer[]>(current?.answers ?? []);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState('');
  const [openSources, setOpenSources] = useState<number | null>(null);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  useEffect(() => { if (current) current.answers = answers; }, [answers]);

  if (!current) {
    return <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <TopBar title="결과에 대해 물어보기" back="/" />
        <Text style={text.body}>먼저 상품을 분석하면 그 결과에 대해 물어볼 수 있어요.</Text>
      </View>
    </SafeAreaView>;
  }
  const { analysis, title } = current;

  const ask = async (value: string) => {
    const asked = value.trim();
    if (asked.length < 2 || pending) return;
    setPending(asked); setQuestion('');
    let next: Answer;
    try {
      const response = await fetch(`${apiBaseUrl}/analysis-questions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...analysis, question: asked }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : '질문을 보내지 못했어요.');
      next = { question: asked, answer: payload.answer, citations: payload.citations ?? [], failed: payload.status !== 'answered' };
    } catch (reason) {
      next = { question: asked, answer: reason instanceof Error ? reason.message : '분석 서버에 연결할 수 없어요.', citations: [], failed: true };
    }
    setAnswers(list => [...list, next].slice(-20));
    setPending('');
  };

  const canSend = !pending && question.trim().length >= 2;
  return <SafeAreaView style={styles.safeArea}>
    <StatusBar style="dark" />
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <View style={styles.header}>
        <TopBar title="결과에 대해 물어보기" onBack={() => router.back()} />
        {title ? <Text numberOfLines={1} style={[text.small, styles.headerSub]}>{title}</Text> : null}
      </View>
      <ScrollView ref={scroll} contentContainerStyle={styles.messages} keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
        <View style={styles.botRow}>
          <View style={styles.avatar}><Icon name="shield-checkmark" size={16} color="#FFFFFF" /></View>
          <View style={[styles.bubble, styles.botBubble]}>
            <Text style={text.body}>이 분석 결과에 대해 궁금한 점을 물어보세요. 분석에서 찾은 근거로만 답하고, 근거에 없는 내용은 확인하지 못했다고 알려 드려요.</Text>
          </View>
        </View>
        {answers.map((item, index) => <View key={`${index}-${item.question}`} style={styles.turn}>
          <View style={[styles.bubble, styles.userBubble]}><Text style={styles.userText}>{item.question}</Text></View>
          <View style={styles.botRow}>
            <View style={styles.avatar}><Icon name="shield-checkmark" size={16} color="#FFFFFF" /></View>
            <View style={[styles.bubble, styles.botBubble]}>
              <Text style={[text.body, item.failed && styles.failed]}>{item.answer}</Text>
              {item.citations.length ? <Pressable accessibilityRole="button" accessibilityState={{ expanded: openSources === index }}
                onPress={() => setOpenSources(openSources === index ? null : index)} style={styles.sourcesToggle}>
                <Icon name="document-text-outline" size={15} color={colors.brandText} />
                <Text style={styles.sourcesText}>{openSources === index ? '근거 접기' : `근거 ${item.citations.length}개 보기`}</Text>
              </Pressable> : null}
              {openSources === index ? item.citations.map(citation =>
                <Text key={citation.id} style={styles.citation}>{citation.text}</Text>) : null}
            </View>
          </View>
        </View>)}
        {pending ? <View style={styles.turn}>
          <View style={[styles.bubble, styles.userBubble]}><Text style={styles.userText}>{pending}</Text></View>
          <View style={styles.botRow}>
            <View style={styles.avatar}><Icon name="shield-checkmark" size={16} color="#FFFFFF" /></View>
            <View style={[styles.bubble, styles.botBubble, styles.typing]}>
              <ActivityIndicator color={colors.brand} size="small" />
              <Text style={text.small}>근거를 찾아 답하는 중이에요</Text>
            </View>
          </View>
        </View> : null}
      </ScrollView>
      <View style={styles.composer}>
        {!answers.length && !pending ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {suggestions.map(item => <Pressable key={item} accessibilityRole="button" onPress={() => ask(item)}
            style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
            <Text style={styles.chipText}>{item}</Text>
          </Pressable>)}
        </ScrollView> : null}
        <View style={styles.inputRow}>
          <TextInput accessibilityLabel="결과에 대한 질문" value={question} onChangeText={setQuestion} maxLength={300}
            placeholder="궁금한 점을 입력해 주세요" placeholderTextColor={colors.textFaint} style={styles.input}
            onSubmitEditing={() => ask(question)} returnKeyType="send" />
          <Pressable accessibilityRole="button" accessibilityLabel="질문 보내기" disabled={!canSend}
            onPress={() => ask(question)} style={[styles.send, !canSend && styles.dim]}>
            <Icon name="arrow-up" size={20} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  fab: { position: 'absolute', right: 20, bottom: 24, width: 62, height: 62, borderRadius: 31, backgroundColor: colors.brand,
    alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  fabPressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 20, gap: 16 },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line, backgroundColor: colors.canvas },
  headerSub: { marginTop: -4, marginLeft: 48 },
  messages: { padding: 16, gap: 16, flexGrow: 1 },
  turn: { gap: 10 },
  botRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, maxWidth: '92%' },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center',
    marginTop: 2 },
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  botBubble: { flexShrink: 1, backgroundColor: colors.card, borderTopLeftRadius: 6, ...shadow },
  userBubble: { alignSelf: 'flex-end', maxWidth: '80%', backgroundColor: colors.brand, borderTopRightRadius: 6 },
  userText: { color: '#FFFFFF', fontSize: 15, lineHeight: 22, fontWeight: '600' },
  typing: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  failed: { color: colors.textMuted },
  sourcesToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 2 },
  sourcesText: { color: colors.brandText, fontSize: 13, fontWeight: '600' },
  citation: { color: colors.textSub, fontSize: 13, lineHeight: 19, backgroundColor: colors.fill, borderRadius: 10, padding: 10 },
  composer: { gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  chips: { gap: 8 },
  chip: { borderRadius: radius.pill, backgroundColor: colors.brandSoft, paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { color: colors.brandText, fontSize: 14, fontWeight: '600' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, minWidth: 0, minHeight: 48, borderRadius: radius.field, backgroundColor: colors.fill, paddingHorizontal: 14,
    fontSize: 15, color: colors.text },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.45 },
});
