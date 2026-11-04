import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius } from './theme';
import { Card, Icon, SectionTitle, text } from './ui';

const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';
const suggestions = ['이 판매자 믿어도 될까?', '구매 전에 꼭 확인할 건 뭐야?', '반품은 어떻게 해야 해?'];

type Answer = { question: string; answer: string; citations: { id: string; text: string }[]; failed?: boolean };

// Questions about this one result, answered only from its own findings; the findings each answer used are shown under it.
export function AskAnalysis({ analysis }: { analysis: Record<string, unknown> }) {
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [busy, setBusy] = useState(false);
  const [openSources, setOpenSources] = useState<number | null>(null);

  const ask = async (value: string) => {
    const asked = value.trim();
    if (asked.length < 2 || busy) return;
    setBusy(true); setQuestion('');
    try {
      const response = await fetch(`${apiBaseUrl}/analysis-questions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...analysis, question: asked }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : '질문을 보내지 못했어요.');
      setAnswers(current => [{ question: asked, answer: payload.answer, citations: payload.citations ?? [],
        failed: payload.status !== 'answered' }, ...current].slice(0, 5));
    } catch (reason) {
      setAnswers(current => [{ question: asked, answer: reason instanceof Error ? reason.message : '분석 서버에 연결할 수 없어요.',
        citations: [], failed: true }, ...current].slice(0, 5));
    } finally { setBusy(false); }
  };

  return <View style={styles.stack}>
    <SectionTitle>결과에 대해 물어보기</SectionTitle>
    <Card>
      <Text style={text.small}>이 분석에서 찾은 근거로만 답해요. 근거에 없는 내용은 확인하지 못했다고 알려 드려요.</Text>
      <View style={styles.chips}>
        {suggestions.map(item => <Pressable key={item} accessibilityRole="button" disabled={busy} onPress={() => ask(item)}
          style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
          <Text style={styles.chipText}>{item}</Text>
        </Pressable>)}
      </View>
      <View style={styles.inputRow}>
        <TextInput accessibilityLabel="결과에 대한 질문" value={question} onChangeText={setQuestion} maxLength={300}
          placeholder="궁금한 점을 입력해 주세요" placeholderTextColor={colors.textFaint} style={styles.input}
          onSubmitEditing={() => ask(question)} returnKeyType="send" />
        <Pressable accessibilityRole="button" accessibilityLabel="질문 보내기" disabled={busy || question.trim().length < 2}
          onPress={() => ask(question)} style={[styles.send, (busy || question.trim().length < 2) && styles.dim]}>
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Icon name="arrow-up" size={20} color="#FFFFFF" />}
        </Pressable>
      </View>
      {answers.map((item, index) => <View key={`${index}-${item.question}`} style={styles.answer}>
        <Text style={text.strong}>{item.question}</Text>
        <Text style={[text.body, item.failed && styles.failed]}>{item.answer}</Text>
        {item.citations.length ? <Pressable accessibilityRole="button" accessibilityState={{ expanded: openSources === index }}
          onPress={() => setOpenSources(openSources === index ? null : index)} style={styles.sourcesToggle}>
          <Icon name="document-text-outline" size={15} color={colors.brandText} />
          <Text style={styles.sourcesText}>{openSources === index ? '근거 접기' : `근거 ${item.citations.length}개 보기`}</Text>
        </Pressable> : null}
        {openSources === index ? item.citations.map(citation => <Text key={citation.id} style={styles.citation}>{citation.text}</Text>) : null}
      </View>)}
    </Card>
  </View>;
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: radius.pill, backgroundColor: colors.brandSoft, paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { color: colors.brandText, fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, minWidth: 0, minHeight: 48, borderRadius: radius.field, backgroundColor: colors.fill, paddingHorizontal: 14,
    fontSize: 15, color: colors.text },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.45 },
  answer: { gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingTop: 12 },
  failed: { color: colors.textMuted },
  sourcesToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 2 },
  sourcesText: { color: colors.brandText, fontSize: 13, fontWeight: '600' },
  citation: { color: colors.textSub, fontSize: 13, lineHeight: 19, backgroundColor: colors.fill, borderRadius: 10, padding: 10 },
});
