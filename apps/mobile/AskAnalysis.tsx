import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChatView, type ChatReply } from './Chat';
import { askHistory } from './lib/account';
import { colors, levels, radius } from './theme';
import { Icon, text } from './ui';

const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';
const resultSuggestions = ['이 판매자 믿어도 될까?', '구매 전에 꼭 확인할 건 뭐야?', '반품은 어떻게 해야 해?', '가격은 적당해?'];
const historySuggestions = ['최근에 분석한 것 중 가장 믿을 만한 곳은?', '주의가 나온 판매처만 알려 줘', '같은 상품을 마켓별로 비교해 줘'];

type Level = keyof typeof levels;

// The result the chat answers about, and what was asked so far. Kept in memory only, so going back to the result and
// returning keeps the conversation; a new analysis starts a new one.
let current: { key: string; analysis: Record<string, unknown>; title: string; replies: ChatReply[] } | null = null;
// Questions about the saved analyses, kept while the app is open.
let historyReplies: ChatReply[] = [];

// On the result screen: a round chat button floating at the bottom right that opens the chat for this result.
export function AskAnalysis({ analysis, title }: { analysis: Record<string, unknown>; title?: string }) {
  const router = useRouter();
  const open = () => {
    // The result screen builds the object on every render, so the same result is recognised by its content.
    const key = JSON.stringify(analysis);
    if (current?.key !== key) current = { key, analysis, title: title ?? '', replies: [] };
    router.push('/ask');
  };
  return <Pressable accessibilityRole="button" accessibilityLabel="AI에게 결과 물어보기" onPress={open} hitSlop={6}
    style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}>
    <Icon name="chatbubble-ellipses" size={28} color="#FFFFFF" />
  </Pressable>;
}

// Questions about the result just shown, answered from that result's own findings.
export function AskChat() {
  const [replies, setReplies] = useState<ChatReply[]>(current?.replies ?? []);
  useEffect(() => { if (current) current.replies = replies; }, [replies]);
  if (!current) return <ChatView title="결과에 대해 물어보기" welcome="먼저 상품을 분석하면 그 결과에 대해 물어볼 수 있어요."
    suggestions={[]} replies={[]} onReplies={() => undefined} send={async question => ({ question, answer: '분석한 결과가 없어요.', citations: [], failed: true })} />;
  const { analysis, title } = current;
  const assessment = (analysis.risk_analysis as { assessment?: { level?: Level; label?: string; score?: number | null; summary?: string } } | null)?.assessment;
  const level = levels[assessment?.level ?? 'undetermined'];
  const send = async (question: string): Promise<ChatReply> => {
    const response = await fetch(`${apiBaseUrl}/analysis-questions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...analysis, question }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : '질문을 보내지 못했어요.');
    return { question, answer: payload.answer, citations: payload.citations ?? [], failed: payload.status !== 'answered' };
  };
  return <ChatView title="결과에 대해 물어보기" subtitle={title} replies={replies} onReplies={setReplies} send={send}
    suggestions={resultSuggestions}
    welcome="이 분석 결과에 대해 궁금한 점을 물어보세요. 분석에서 찾은 근거로만 답하고, 근거에 없는 내용은 확인하지 못했다고 알려 드려요."
    context={assessment ? <View style={[styles.context, { backgroundColor: level.soft }]}>
      <Icon name={level.icon} size={26} color={level.color} />
      <View style={styles.contextText}>
        <Text style={[styles.contextLevel, { color: level.text }]}>{assessment.label}{assessment.score != null ? ` · ${assessment.score}점` : ''}</Text>
        {assessment.summary ? <Text numberOfLines={2} style={text.small}>{assessment.summary}</Text> : null}
      </View>
    </View> : null} />;
}

// Questions about everything the signed-in shopper analyzed: the server picks the records the question is about and
// answers from their stored results, each answer listing the records it used.
export function HistoryChat() {
  const [replies, setReplies] = useState<ChatReply[]>(historyReplies);
  useEffect(() => { historyReplies = replies; }, [replies]);
  const send = async (question: string): Promise<ChatReply> => {
    const reply = await askHistory(apiBaseUrl, question);
    return { question, answer: reply.answer, citations: reply.citations ?? [], records: reply.records ?? [],
      failed: reply.status === 'unavailable' };
  };
  return <ChatView title="내 분석 기록에 물어보기" subtitle="저장된 분석 결과로만 답해요" icon="time" replies={replies}
    onReplies={setReplies} send={send} suggestions={historySuggestions}
    welcome="쿠팡·G마켓·옥션에서 분석해 둔 기록을 찾아 답해요. 결과는 분석한 날 기준이라, 지금 판매 페이지와 다를 수 있어요."
    context={<View style={styles.note}>
      <Icon name="lock-closed-outline" size={16} color={colors.textSub} />
      <Text style={[text.small, styles.contextText]}>내 계정의 기록만 읽어요. 질문할 때 관련 기록 몇 개만 골라 AI에게 보내요.</Text>
    </View>} />;
}

const styles = StyleSheet.create({
  fab: { position: 'absolute', right: 20, bottom: 24, width: 62, height: 62, borderRadius: 31, backgroundColor: colors.brand,
    alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  fabPressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
  context: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radius.card, padding: 14 },
  contextText: { flex: 1, minWidth: 0, gap: 2 },
  contextLevel: { fontSize: 17, fontWeight: '800' },
  note: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
});
