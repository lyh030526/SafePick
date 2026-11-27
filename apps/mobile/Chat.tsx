import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { HistoryRecord } from './lib/account';
import { colors, levels, radius, shadow } from './theme';
import { Icon, type IconName, text } from './ui';

export type ChatReply = {
  question: string;
  answer: string;
  citations: { id: string; text: string; record_id?: string | null }[];
  records?: HistoryRecord[];
  failed?: boolean;
};

const won = (price: string) => (/^\d+$/.test(price) ? `${Number(price).toLocaleString('ko-KR')}원` : price);

// One chat screen for both kinds of question: about the result just shown, and about the shopper's saved analyses.
// Answers come only from the analyses; the evidence (and, for saved ones, the records) each answer used sits under it.
export function ChatView({ title, subtitle, context, welcome, suggestions, replies, onReplies, send, icon = 'chatbubbles' }: {
  title: string; subtitle?: string; context?: ReactNode; welcome: string; suggestions: string[];
  replies: ChatReply[]; onReplies: (replies: ChatReply[]) => void; send: (question: string) => Promise<ChatReply>;
  icon?: IconName;
}) {
  const router = useRouter();
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const latest = useRef(replies);
  useEffect(() => { latest.current = replies; }, [replies]);

  const ask = async (value: string) => {
    const asked = value.trim();
    if (asked.length < 2 || pending) return;
    setPending(asked);
    setQuestion('');
    let reply: ChatReply;
    try { reply = await send(asked); } catch (reason) {
      reply = { question: asked, answer: reason instanceof Error ? reason.message : '분석 서버에 연결할 수 없어요.', citations: [], failed: true };
    }
    onReplies([...latest.current, reply].slice(-20));
    setPending('');
  };

  const canSend = !pending && question.trim().length >= 2;
  // Android draws under the status bar and the system navigation bar, so both edges are kept clear: the input sits
  // above the phone's own bottom bar.
  return <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
    <StatusBar style="dark" />
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="뒤로" hitSlop={8} onPress={() => router.back()}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
          <Icon name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <View style={styles.headerText}>
          <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>{title}</Text>
          {subtitle ? <Text numberOfLines={1} style={text.small}>{subtitle}</Text> : null}
        </View>
      </View>
      <ScrollView ref={scroll} style={styles.scroll} contentContainerStyle={styles.messages} keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
        {context}
        <View style={styles.welcome}>
          <View style={styles.welcomeIcon}><Icon name={icon} size={24} color={colors.brand} /></View>
          <Text style={[text.body, styles.welcomeText]}>{welcome}</Text>
        </View>
        {replies.map((item, index) => <View key={`${index}-${item.question}`} style={styles.turn}>
          <UserBubble text={item.question} />
          <BotBubble>
            <Text style={[styles.answer, item.failed && styles.failed]}>{item.answer}</Text>
            {item.records?.length ? <View style={styles.records}>
              <Text style={styles.recordsLabel}>참고한 분석 기록</Text>
              {item.records.map(record => <RecordCard key={record.id} record={record} />)}
            </View> : null}
            {item.citations.length ? <Pressable accessibilityRole="button" accessibilityState={{ expanded: open === index }}
              onPress={() => setOpen(open === index ? null : index)} style={({ pressed }) => [styles.sourcesToggle, pressed && styles.pressed]}>
              <Icon name="document-text-outline" size={15} color={colors.brandText} />
              <Text style={styles.sourcesText}>{open === index ? '근거 접기' : `근거 ${item.citations.length}개 보기`}</Text>
              <Icon name={open === index ? 'chevron-up' : 'chevron-down'} size={14} color={colors.brandText} />
            </Pressable> : null}
            {open === index ? <View style={styles.citations}>
              {item.citations.map(citation => <Text key={citation.id} style={styles.citation}>{citation.text}</Text>)}
            </View> : null}
          </BotBubble>
        </View>)}
        {pending ? <View style={styles.turn}>
          <UserBubble text={pending} />
          <BotBubble>
            <View style={styles.typing}>
              <ActivityIndicator color={colors.brand} size="small" />
              <Text style={text.small}>근거를 찾아 답하는 중이에요</Text>
            </View>
          </BotBubble>
        </View> : null}
      </ScrollView>
      <View style={styles.composer}>
        {!pending ? <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.chips}>
          {suggestions.map(item => <Pressable key={item} accessibilityRole="button" onPress={() => ask(item)}
            style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
            <Text style={styles.chipText}>{item}</Text>
          </Pressable>)}
        </ScrollView> : null}
        <View style={styles.inputRow}>
          <TextInput accessibilityLabel="질문" value={question} onChangeText={setQuestion} maxLength={300}
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

function UserBubble({ text: value }: { text: string }) {
  return <View style={styles.userBubble}><Text style={styles.userText}>{value}</Text></View>;
}

function BotBubble({ children }: { children: ReactNode }) {
  return <View style={styles.botRow}>
    <View style={styles.avatar}><Icon name="shield-checkmark" size={15} color="#FFFFFF" /></View>
    <View style={styles.botBubble}>{children}</View>
  </View>;
}

// A saved analysis an answer drew on: where and when it was analyzed and what it found; tapping opens the listing.
function RecordCard({ record }: { record: HistoryRecord }) {
  const level = levels[record.level];
  return <Pressable accessibilityRole="link" onPress={() => record.product_url && Linking.openURL(record.product_url)}
    style={({ pressed }) => [styles.record, pressed && styles.pressed]}>
    <View style={[styles.recordDot, { backgroundColor: level.color }]} />
    <View style={styles.flex}>
      <Text numberOfLines={1} style={styles.recordTitle}>{record.title}</Text>
      <Text numberOfLines={1} style={text.small}>
        {[record.market, record.seller, record.price && won(record.price), record.analyzed_at && `${record.analyzed_at} 분석`]
          .filter(Boolean).join(' · ')}
      </Text>
    </View>
    <Text style={[styles.recordLevel, { color: level.text }]}>{record.label}{record.score != null ? ` ${record.score}` : ''}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },
  safe: { flex: 1, backgroundColor: colors.card },
  scroll: { backgroundColor: colors.canvas },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  messages: { width: '100%', maxWidth: 680, alignSelf: 'center', padding: 16, gap: 16, flexGrow: 1 },
  welcome: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: colors.brandSoft, borderRadius: radius.card, padding: 16 },
  welcomeIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  welcomeText: { flex: 1, color: colors.text },
  turn: { gap: 10 },
  userBubble: { alignSelf: 'flex-end', maxWidth: '82%', backgroundColor: colors.brand, borderRadius: 20, borderBottomRightRadius: 6,
    paddingHorizontal: 15, paddingVertical: 10 },
  userText: { color: '#FFFFFF', fontSize: 15, lineHeight: 22, fontWeight: '600' },
  botRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, maxWidth: '94%' },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  botBubble: { flexShrink: 1, gap: 10, backgroundColor: colors.card, borderRadius: 20, borderTopLeftRadius: 6, paddingHorizontal: 15,
    paddingVertical: 12, ...shadow },
  answer: { color: colors.text, fontSize: 15, lineHeight: 23 },
  failed: { color: colors.textMuted },
  typing: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  records: { gap: 6 },
  recordsLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  record: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.fill, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  recordDot: { width: 8, height: 8, borderRadius: 4 },
  recordTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  recordLevel: { fontSize: 13, fontWeight: '800' },
  sourcesToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 2 },
  sourcesText: { color: colors.brandText, fontSize: 13, fontWeight: '700' },
  citations: { gap: 6 },
  citation: { color: colors.textSub, fontSize: 13, lineHeight: 19, backgroundColor: colors.fill, borderRadius: 10, padding: 10 },
  composer: { gap: 10, paddingTop: 10, paddingBottom: 14, backgroundColor: colors.card, borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line },
  chips: { gap: 8, paddingHorizontal: 16 },
  chip: { borderRadius: radius.pill, backgroundColor: colors.brandSoft, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { color: colors.brandText, fontSize: 14, fontWeight: '700' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, backgroundColor: colors.fill,
    borderRadius: radius.pill, paddingLeft: 16, paddingRight: 5, paddingVertical: 5 },
  input: { flex: 1, minWidth: 0, minHeight: 40, fontSize: 15, color: colors.text },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.4 },
});
