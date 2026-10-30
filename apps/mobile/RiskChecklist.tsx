import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from './theme';
import { CheckCircle } from './ui';

type Condition = { status: 'found' | 'unknown'; text: string; quotes: string[] };
export type RiskAnalysis = {
  status: 'completed' | 'insufficient' | 'unavailable';
  message: string;
  conditions: Record<'description' | 'components' | 'options' | 'shipping' | 'returns' | 'warranty', Condition>;
  checklist: { id: string; category: string; kind: 'attention' | 'needs_check'; title: string;
    explanation: string; quotes: string[]; how_to_check: string }[];
  warnings: string[];
  assessment?: {
    level: 'high' | 'moderate' | 'low' | 'undetermined'; label: string; summary: string;
    reasons: string[]; missing_checks: string[];
    criteria: { key: string; label: string; status: 'confirmed' | 'attention' | 'unknown'; detail: string }[];
    rule_version: string;
  };
};
const labels: Record<keyof RiskAnalysis['conditions'], string> = {
  description: '상세 설명', components: '구성품', options: '옵션', shipping: '배송 조건', returns: '반품·교환 조건', warranty: '보증·AS',
};
const criterionLabels = { confirmed: '확인됨', attention: '주의 항목 있음', unknown: '추가 확인' };

export function RiskChecklist({ analysis, sourceUrl }: { analysis: RiskAnalysis | null; sourceUrl: string }) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [showConditions, setShowConditions] = useState(false);
  const complete = analysis?.status === 'completed';
  const assessment = analysis?.assessment;
  const level = complete ? assessment?.level ?? 'undetermined' : 'undetermined';
  const levelLabel = level === 'undetermined' ? '판단 보류' : assessment?.label;
  const total = complete ? analysis.checklist.length : 0;
  return <View style={styles.section}>
    <Text style={styles.heading}>구매 전 주의 수준</Text>
    <View accessibilityLabel={`구매 전 주의 수준 ${levelLabel}`} style={styles.card}>
      <View style={[styles.levelBadge, levelSoftStyles[level]]}>
        <Text style={[styles.levelTitle, levelTextStyles[level]]}>{levelLabel}</Text>
      </View>
      <Text style={styles.summaryText}>{assessment?.summary ?? '주의 수준을 확인하려면 상품 자료를 추가하거나 다시 분석해 주세요.'}</Text>
      {assessment?.reasons.length ? <View style={styles.block}>
        <Text style={styles.label}>판단 근거</Text>
        {assessment.reasons.map((reason, index) => <Text key={index} style={styles.body}>• {reason}</Text>)}
      </View> : null}
      {assessment?.criteria.length ? <View style={styles.criteria}>
        {assessment.criteria.map(criterion => <View key={criterion.key} style={styles.criterion}>
          <View style={styles.criterionHead}>
            <Text style={styles.criterionLabel}>{criterion.label}</Text>
            <Text style={[styles.chip, criterionStyles[criterion.status]]}>{criterionLabels[criterion.status]}</Text>
          </View>
          <Text style={styles.meta}>{criterion.detail}</Text>
        </View>)}
      </View> : null}
      {assessment?.missing_checks.length ? <View style={styles.block}>
        <Text style={styles.label}>아직 확인할 정보</Text>
        <Text style={styles.body}>{assessment.missing_checks.join(' · ')}</Text>
      </View> : null}
      <Text style={styles.meta}>수집한 자료에서 확인한 신호의 주의 수준입니다. 판매자 신뢰도나 사기 확률, 정품·안전을 인증하는 결과가 아닙니다.</Text>
    </View>
    <Text style={styles.heading}>구매 전 체크리스트</Text>
    <View style={[styles.card, styles.summary, !complete && styles.neutral]}>
      <Text style={styles.summaryTitle}>{complete ? '수집한 상품 설명 분석' : '위험 신호 분석 미완료'}</Text>
      <Text style={styles.body}>{analysis?.message ?? '새 분석을 시작하면 상세 설명의 확인 항목을 볼 수 있어요.'}</Text>
      <Text style={styles.meta}>사기 확률이나 안전 등급이 아닙니다. 수집하지 못한 내용은 판단하지 않아요.</Text>
    </View>
    {complete ? <>
      {total > 0 ? <View style={styles.progress}>
        <Text style={styles.counter}>직접 확인한 항목 {checked.size} / {total}</Text>
        <View style={styles.track}><View style={[styles.fill, { width: `${(checked.size / total) * 100}%` }]} /></View>
      </View> : null}
      {analysis.checklist.map(item => <View key={item.id} style={styles.card}>
        <Text style={[styles.chip, item.kind === 'attention' ? styles.attentionChip : styles.missingChip]}>{item.kind === 'attention' ? '표현·불일치 확인' : '수집 자료에서 확인 불가'}</Text>
        <Pressable accessibilityRole="checkbox" accessibilityLabel={`${item.title} 확인 완료`}
          accessibilityState={{ checked: checked.has(item.id) }} onPress={() => setChecked(previous => {
            const next = new Set(previous); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next;
          })} style={styles.checkRow}>
          <CheckCircle checked={checked.has(item.id)} />
          <Text style={[styles.cardTitle, checked.has(item.id) && styles.cardTitleDone]}>{item.title}</Text>
        </Pressable>
        <Text style={styles.body}>{item.explanation}</Text>
        <Text style={styles.label}>원문 근거</Text>
        {item.quotes.length ? item.quotes.map((quote, index) => <Text key={index} selectable style={styles.quote}>{quote}</Text>)
          : <Text style={styles.meta}>수집한 자료에서 해당 안내를 찾지 못했습니다. 실제 페이지에서 안내를 펼쳐 확인해 주세요.</Text>}
        <Text style={styles.label}>확인 방법</Text>
        <Text style={styles.body}>{item.how_to_check}</Text>
      </View>)}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showConditions }}
        onPress={() => setShowConditions(value => !value)} style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}>
        <Text style={styles.toggleText}>{showConditions ? '상품 조건 원문 접기' : '상품 조건 원문 보기'}</Text>
      </Pressable>
      {showConditions ? <View style={styles.card}>
        {(Object.keys(labels) as (keyof RiskAnalysis['conditions'])[]).map((key, index) => {
          const condition = analysis.conditions[key];
          return <View key={key} style={[styles.condition, index > 0 && styles.conditionDivider]}>
            <Text style={styles.label}>{labels[key]}</Text>
            <Text selectable style={styles.body}>{condition.text}</Text>
            {condition.status === 'unknown' && condition.quotes.map((quote, index) => <Text key={index} selectable style={styles.quote}>{quote}</Text>)}
          </View>;
        })}
      </View> : null}
      <Pressable accessibilityRole="link" onPress={() => Linking.openURL(sourceUrl)} style={styles.sourceLink}>
        <Text style={styles.link}>분석한 판매 페이지 열기</Text>
      </Pressable>
    </> : null}
    {analysis?.warnings.map((warning, index) => <Text key={index} style={[styles.meta, styles.warning]}>{warning}</Text>)}
  </View>;
}

const styles = StyleSheet.create({
  section: { marginTop: 8, gap: 12 },
  heading: { color: colors.text, fontSize: 20, fontWeight: '700', lineHeight: 28, marginTop: 12, paddingHorizontal: 4, letterSpacing: -0.4 },
  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: 20, gap: 10 },
  levelBadge: { alignSelf: 'flex-start', borderRadius: radius.field, paddingHorizontal: 16, paddingVertical: 8 },
  levelTitle: { fontSize: 26, lineHeight: 34, fontWeight: '800', letterSpacing: -0.5 },
  summaryText: { color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '600', letterSpacing: -0.2 },
  block: { gap: 4 },
  criteria: { backgroundColor: colors.fill, borderRadius: 14, padding: 14, gap: 12 },
  criterion: { gap: 4 },
  criterionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  criterionLabel: { color: colors.text, fontSize: 14, fontWeight: '700' },
  summary: { backgroundColor: colors.blueSoft },
  neutral: { backgroundColor: colors.card },
  summaryTitle: { color: colors.blueText, fontSize: 16, fontWeight: '700', lineHeight: 24 },
  body: { color: colors.textSub, fontSize: 15, lineHeight: 23, flexShrink: 1 },
  meta: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  warning: { paddingHorizontal: 4 },
  progress: { gap: 8, paddingHorizontal: 4, marginTop: 4 },
  counter: { color: colors.textSub, fontSize: 14, fontWeight: '600' },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.blue },
  chip: { alignSelf: 'flex-start', overflow: 'hidden', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, fontSize: 12, fontWeight: '700' },
  attentionChip: { backgroundColor: colors.orangeSoft, color: colors.orangeText },
  missingChip: { backgroundColor: colors.fill, color: colors.textSub },
  checkRow: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 44 },
  cardTitle: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '700', lineHeight: 25, letterSpacing: -0.3 },
  cardTitleDone: { color: colors.textMuted },
  label: { color: colors.text, fontSize: 14, fontWeight: '700', lineHeight: 21, marginTop: 4 },
  quote: { color: colors.textSub, fontSize: 14, lineHeight: 22, backgroundColor: colors.fill, borderRadius: 12, padding: 12 },
  toggle: { backgroundColor: colors.line, borderRadius: radius.button, minHeight: 50, alignItems: 'center', justifyContent: 'center' },
  toggleText: { color: colors.textSub, fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  link: { color: colors.blue, fontSize: 15, fontWeight: '600', lineHeight: 22 },
  condition: { paddingVertical: 4, gap: 6 },
  conditionDivider: { borderTopColor: colors.line, borderTopWidth: 1, paddingTop: 14 },
  sourceLink: { paddingVertical: 10, alignItems: 'center' },
});

const levelSoftStyles = StyleSheet.create({
  high: { backgroundColor: colors.redSoft }, moderate: { backgroundColor: colors.orangeSoft },
  low: { backgroundColor: colors.blueSoft }, undetermined: { backgroundColor: colors.fill },
});
const levelTextStyles = StyleSheet.create({
  high: { color: colors.red }, moderate: { color: colors.orangeText },
  low: { color: colors.blueText }, undetermined: { color: colors.textSub },
});
const criterionStyles = StyleSheet.create({
  confirmed: { backgroundColor: colors.greenSoft, color: colors.green },
  attention: { backgroundColor: colors.orangeSoft, color: colors.orangeText },
  unknown: { backgroundColor: colors.card, color: colors.textSub },
});
