import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ScreenFrame } from '../ScreenFrame';
import { pickImage, type AttachedImage } from '../lib/pickImage';
import { colors, levels, radius, type } from '../theme';
import { Button, Card, CheckCircle, Icon, Pill, SectionTitle, text } from '../ui';

const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

type Level = keyof typeof levels;
type Signal = { kind: string; label: string; severity: 'high' | 'moderate' | 'info'; quote: string; advice: string };
type Link = { url: string; domain: string | null; status: string; label: string; message: string };
export type ConversationCheck = { level: Level; label: string; summary: string; signals: Signal[]; links: Link[];
  lookup_numbers?: { kind: 'account' | 'phone'; masked: string; bank: string | null }[]; read_length: number; warnings: string[] };

const channels: { id: 'marketplace' | 'messenger'; label: string; icon: 'storefront-outline' | 'chatbubbles-outline' }[] = [
  { id: 'marketplace', label: '쿠팡 등 마켓 안 문의·채팅', icon: 'storefront-outline' },
  { id: 'messenger', label: '카카오톡·문자 등 마켓 밖', icon: 'chatbubbles-outline' },
];
const severityTone = { high: 'bad', moderate: 'warn', info: 'neutral' } as const;
const linkTone = (status: string) => ['reported', 'impersonates', 'missing', 'expired', 'new_short'].includes(status) ? 'bad'
  : status === 'new' ? 'warn' : status === 'marketplace' ? 'good' : 'neutral';

// The conversation with a seller, checked for the tactics that move a purchase off the platform. Nothing is stored.
export default function ChatCheck() {
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [pasted, setPasted] = useState('');
  const [channel, setChannel] = useState<'marketplace' | 'messenger' | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ConversationCheck | null>(null);
  const hasMaterial = images.length > 0 || !!pasted.trim();

  const add = async () => {
    try {
      const image = await pickImage(images, 4);
      if (image) { setImages(current => [...current, { ...image, name: image.name.replace(/^이미지/, '대화 캡처') }]); setConsent(false); setError(''); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : '이미지를 첨부하지 못했어요.'); }
  };
  const check = async () => {
    if (!hasMaterial) { setError('대화 캡처를 첨부하거나 대화 내용을 붙여넣어 주세요.'); return; }
    if (!consent) { setError('대화 자료의 AI 분석 동의를 확인해 주세요.'); return; }
    setBusy(true); setError(''); setResult(null);
    try {
      const response = await fetch(`${apiBaseUrl}/conversation-checks`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: images.map(({ base64_data, mime_type }) => ({ base64_data, mime_type })),
          text: pasted.trim() || undefined, channel: channel ?? 'unknown' }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : '대화를 확인하지 못했어요.');
      setResult(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '분석 서버에 연결할 수 없어요.');
    } finally { setBusy(false); }
  };

  return <ScreenFrame title="판매자 대화 확인" back="/" subtitle="판매자와 나눈 대화에서 흔한 사기 수법을 찾아요.">
    {result ? <ConversationResult result={result} onReset={() => { setResult(null); setImages([]); setPasted(''); setConsent(false); }} /> : <>
      <Card>
        <Text style={text.strong}>어디서 나눈 대화인가요?</Text>
        <View style={styles.choices}>
          {channels.map(item => <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ checked: channel === item.id }}
            onPress={() => setChannel(item.id)} style={[styles.choice, channel === item.id && styles.choiceOn]}>
            <Icon name={item.icon} size={18} color={channel === item.id ? colors.brandText : colors.textSub} />
            <Text style={[styles.choiceText, channel === item.id && styles.choiceTextOn]}>{item.label}</Text>
          </Pressable>)}
        </View>
      </Card>
      <Card>
        <Text style={text.strong}>대화 캡처 ({images.length}/4)</Text>
        <Text style={text.small}>계좌번호·링크·금액이 보이게 캡처해 주세요. 내 전화번호나 주소는 가려도 돼요.</Text>
        {images.map((image, index) => <View key={`${index}-${image.name}`} style={styles.imageRow}>
          <Image accessibilityLabel={`대화 캡처 ${index + 1}`} source={{ uri: image.uri }} style={styles.preview} resizeMode="cover" />
          <Text numberOfLines={1} style={[text.body, styles.flex]}>{image.name}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`대화 캡처 ${index + 1} 삭제`} hitSlop={8}
            onPress={() => { setImages(current => current.filter((_, i) => i !== index)); setConsent(false); }}>
            <Icon name="close-circle" size={22} color={colors.textMuted} />
          </Pressable>
        </View>)}
        <Button tone="secondary" icon="image-outline" label={`대화 캡처 첨부 (${images.length}/4)`} disabled={images.length >= 4} onPress={add} />
        <Text style={text.small}>또는 대화 내용을 붙여넣어도 돼요.</Text>
        <TextInput accessibilityLabel="대화 내용" multiline maxLength={8000} value={pasted}
          onChangeText={value => { setPasted(value); setConsent(false); }}
          placeholder="판매자: 재고가 마지막이라 계좌로 먼저 입금해 주시면…" placeholderTextColor={colors.textFaint} style={styles.textArea} />
      </Card>
      {hasMaterial ? <Pressable accessibilityRole="checkbox" accessibilityLabel="대화 자료 AI 분석 동의" accessibilityState={{ checked: consent }}
        onPress={() => setConsent(value => !value)} style={styles.consent}>
        <CheckCircle checked={consent} />
        <Text style={[text.body, styles.flex]}>대화 캡처와 내용을 OpenAI에 보내 분석하는 데 동의합니다. SafePick은 대화를 저장하지 않아요.</Text>
      </Pressable> : null}
      {error ? <Text accessibilityRole="alert" style={text.error}>{error}</Text> : null}
      <Button label={busy ? '대화를 확인하고 있어요' : '대화 확인하기'} icon="shield-checkmark" busy={busy} onPress={check} />
      <Text style={text.small}>이미 돈을 보냈다면 바로 은행 고객센터에 지급정지를 요청하고 경찰청(112)에 신고하세요.</Text>
    </>}
  </ScreenFrame>;
}

export function ConversationResult({ result, onReset }: { result: ConversationCheck; onReset: () => void }) {
  const tone = levels[result.level];
  return <>
    <Card style={styles.verdict}>
      <View accessibilityLabel={`대화 주의 수준 ${result.label}`} style={[styles.verdictHead, { backgroundColor: tone.soft }]}>
        <Text style={[styles.eyebrow, { color: tone.text }]}>대화 주의 수준</Text>
        <View style={styles.levelRow}>
          <Icon name={tone.icon} size={32} color={tone.color} />
          <Text style={[styles.levelTitle, { color: tone.text }]}>{result.label}</Text>
        </View>
        <Text style={text.body}>{result.summary}</Text>
      </View>
    </Card>
    {result.signals.length ? <>
      <SectionTitle>찾은 신호</SectionTitle>
      {result.signals.map((signal, index) => <Card key={`${signal.kind}-${index}`}>
        <Pill label={signal.label} tone={severityTone[signal.severity]} dot />
        <Text selectable style={styles.quote}>{signal.quote}</Text>
        <View style={styles.advice}>
          <Icon name="checkmark-done-outline" size={17} color={colors.brandText} />
          <Text style={[text.body, styles.flex]}>{signal.advice}</Text>
        </View>
      </Card>)}
    </> : null}
    {result.links.length ? <>
      <SectionTitle>대화 속 링크</SectionTitle>
      {result.links.map(link => <Card key={link.url}>
        <Pill label={link.label} tone={linkTone(link.status)} dot />
        <Text selectable numberOfLines={2} style={text.strong}>{link.url}</Text>
        <Text style={text.body}>{link.message}</Text>
      </Card>)}
    </> : null}
    {result.lookup_numbers?.length ? <>
      <SectionTitle>사기 신고 이력 확인</SectionTitle>
      <Card>
        <Text style={text.body}>대화에 나온 계좌·전화번호예요. 경찰청 공식 앱 &apos;사이버캅&apos;에서 캡처의 전체 번호로 사기 신고 이력을 조회해 보세요.
          SafePick은 번호를 다른 곳으로 보내지 않아요.</Text>
        {result.lookup_numbers.map(item => <View key={item.masked} style={styles.number}>
          <Icon name={item.kind === 'account' ? 'card-outline' : 'call-outline'} size={18} color={colors.brandText} />
          <Text style={[text.strong, styles.flex]}>{item.kind === 'account' ? `${item.bank ? `${item.bank} ` : ''}계좌` : '전화번호'} {item.masked}</Text>
        </View>)}
        <Text style={text.small}>조회되지 않는다고 안전한 것은 아니에요. 신고가 아직 쌓이지 않은 새 번호일 수 있어요.</Text>
      </Card>
    </> : null}
    {result.warnings.map(warning => <Text key={warning} style={text.small}>{warning}</Text>)}
    <Button tone="secondary" icon="refresh" label="다른 대화 확인하기" onPress={onReset} />
  </>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  choices: { gap: 8 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radius.field, borderWidth: 1.5, borderColor: colors.line,
    paddingHorizontal: 14, minHeight: 50 },
  choiceOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  choiceText: { ...type.body, color: colors.textSub, fontWeight: '600' },
  choiceTextOn: { color: colors.brandText },
  imageRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.fill, borderRadius: radius.field, padding: 8 },
  preview: { width: 48, height: 48, borderRadius: 8, backgroundColor: colors.card },
  textArea: { minHeight: 110, textAlignVertical: 'top', backgroundColor: colors.fill, borderRadius: radius.field, padding: 14,
    fontSize: 15, lineHeight: 22, color: colors.text },
  consent: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, borderRadius: radius.field, backgroundColor: colors.brandSoft },
  verdict: { padding: 0, gap: 0, overflow: 'hidden' },
  verdictHead: { padding: 20, gap: 8 },
  eyebrow: { fontSize: 13, fontWeight: '700' },
  levelRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  levelTitle: { ...type.display, fontSize: 30, lineHeight: 38 },
  quote: { ...type.small, fontSize: 14, color: colors.textSub, backgroundColor: colors.fill, borderRadius: 12, padding: 12,
    borderLeftWidth: 3, borderLeftColor: colors.line },
  number: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.fill, borderRadius: 12, padding: 12 },
  advice: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: colors.brandSoft, borderRadius: 12, padding: 12 },
});
