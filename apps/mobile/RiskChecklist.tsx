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
  review_complaints?: { low_reviews: number; complaints: number; same_seller: number; quotes: string[] } | null;
  assessment?: {
    level: 'high' | 'moderate' | 'low' | 'undetermined'; label: string; summary: string;
    reasons: string[]; missing_checks: string[];
    criteria: { key: string; label: string; status: 'confirmed' | 'partial' | 'attention' | 'unknown'; detail: string }[];
    score?: number | null; score_label?: string; coverage_percent?: number; checked_count?: number;
    rule_version: string;
    domain?: { status: 'missing' | 'expired' | 'new_short' | 'new' | 'established' | 'marketplace' | 'unavailable';
      label: string; message: string; domain: string | null; registered_on: string | null; expires_on: string | null } | null;
  };
};
const labels: Record<keyof RiskAnalysis['conditions'], string> = {
  description: '상세 설명', components: '구성품', options: '옵션', shipping: '배송 조건', returns: '반품·교환 조건', warranty: '보증·AS',
};
const criterionLabels = { confirmed: '확인됨', partial: '일부 확인', attention: '주의 항목 있음', unknown: '추가 확인' };

export function RiskChecklist({ analysis, sourceUrl }: { analysis: RiskAnalysis | null; sourceUrl: string }) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [showConditions, setShowConditions] = useState(false);
  const complete = analysis?.status === 'completed';
  const assessment = analysis?.assessment;
  // A closed seller or a missing domain is high, and a very new short-term domain is moderate, even when the page could
  // not be read or the description analysis did not finish.
  const decisive = assessment?.level === 'high' || assessment?.domain?.status === 'new_short';
  const level = complete || decisive ? assessment?.level ?? 'undetermined' : 'undetermined';
  const domain = assessment?.domain && !['marketplace', 'unavailable'].includes(assessment.domain.status) ? assessment.domain : null;
  const levelLabel = level === 'undetermined' ? '판단 보류' : assessment?.label;
  const total = complete ? analysis.checklist.length : 0;
  // The line under the level already states the first reason, so the list repeats only the rest.
  const otherReasons = (assessment?.reasons ?? []).filter(reason => reason !== keyLine(assessment, level));
  return <View style={styles.section}>
    <Text style={styles.heading}>구매 전 주의 수준</Text>
    <View accessibilityLabel={`구매 전 주의 수준 ${levelLabel}`} style={styles.card}>
      {/* The level and the one reason behind it come first; the score only says how much evidence was found. */}
      <View style={[styles.levelBadge, levelSoftStyles[level]]}>
        <Text style={[styles.levelTitle, levelTextStyles[level]]}>{levelLabel}</Text>
      </View>
      {keyLine(assessment, level) ? <Text style={styles.keyLine}>{keyLine(assessment, level)}</Text> : null}
      <Text style={styles.summaryText}>{assessment?.summary ?? '주의 수준을 확인하려면 상품 자료를 추가하거나 다시 분석해 주세요.'}</Text>
      {assessment?.missing_checks.length ? <View style={styles.todo}>
        <Text style={styles.label}>구매 전에 확인할 것</Text>
        {assessment.missing_checks.map(item => <Text key={item} style={styles.body}>☐ {item}</Text>)}
      </View> : null}
      {otherReasons.length ? <View style={styles.block}>
        <Text style={styles.label}>판단 근거</Text>
        {otherReasons.map((reason, index) => <Text key={index} style={styles.body}>• {reason}</Text>)}
      </View> : null}
      {complete || decisive ? <ScoreSummary assessment={assessment} level={level} /> : null}
      {analysis?.review_complaints?.complaints ? <View accessibilityLabel="낮은 별점 리뷰 요약" style={styles.criteria}>
        <Text style={styles.label}>낮은 별점 리뷰 (참고)</Text>
        <Text style={styles.body}>1~2점 리뷰 {analysis.review_complaints.low_reviews}개 중 {analysis.review_complaints.complaints}개가
          가품·미배송·연락두절 등을 언급했고, 그중 이 판매자에 대한 리뷰는 {analysis.review_complaints.same_seller}개예요.
          한 상품의 리뷰에는 다른 판매자 리뷰가 섞여 있고 추측도 많아 주의 수준에는 반영하지 않았어요.</Text>
        {analysis.review_complaints.quotes.map((quote, index) => <Text key={index} style={styles.meta}>“{quote}”</Text>)}
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
      {domain ? <View accessibilityLabel={`도메인 ${domain.label}`} style={styles.block}>
        <Text style={styles.label}>도메인 등록 정보</Text>
        <Text style={styles.body}>{[domain.domain, domain.label, domain.registered_on && `등록 ${domain.registered_on}`,
          domain.expires_on && `만료 ${domain.expires_on}`].filter(Boolean).join(' · ')}</Text>
        <Text style={styles.meta}>{domain.message}</Text>
      </View> : null}
      <Text style={styles.meta}>신뢰 점수는 확인한 근거로 계산한 참고 점수이고, 주의 수준은 수집한 자료에서 확인한 신호입니다. 사기 확률이 아니며 판매자나 정품·안전을 인증하지 않습니다.</Text>
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

// The single line under the level: why it is high or moderate, what is still missing when it is held back.
function keyLine(assessment: RiskAnalysis['assessment'], level: string) {
  if (!assessment) return '';
  if (level === 'undetermined' && assessment.missing_checks.length) return `더 확인할 것: ${assessment.missing_checks.slice(0, 2).join(', ')}`;
  return assessment.reasons[0] ?? '';
}

function ScoreSummary({ assessment, level }: { assessment: RiskAnalysis['assessment']; level: keyof typeof levelTextStyles }) {
  if (!assessment || assessment.coverage_percent === undefined) return null;
  const coverage = assessment.coverage_percent;
  const total = assessment.criteria.length;
  const scored = assessment.score !== null && assessment.score !== undefined;
  return <View accessibilityLabel={scored ? `신뢰 점수 ${assessment.score}점 ${assessment.score_label}` : '신뢰 점수 보류'} style={styles.score}>
    <Text style={styles.scoreCaption}>신뢰 점수 · 확인된 근거의 양 (참고)</Text>
    <View style={styles.scoreRow}>
      {scored ? <Text style={[styles.scoreNumber, levelTextStyles[level]]}>{assessment.score}<Text style={styles.scoreUnit}> / 100</Text></Text>
        : <Text style={styles.scoreWithheld}>점수 보류</Text>}
      {scored ? <Text style={[styles.chip, styles.scoreChip, levelSoftStyles[level], levelTextStyles[level]]}>{assessment.score_label}</Text> : null}
    </View>
    <View style={styles.track}><View style={[styles.fill, { width: `${coverage}%` }]} /></View>
    <Text style={styles.meta}>
      근거 확인 {assessment.checked_count ?? 0} / {total}개 기준 · 반영 비중 {coverage}%
      {scored ? '' : ' — 확인된 근거가 부족해 점수를 매기지 않았어요.'}
    </Text>
  </View>;
}

const styles = StyleSheet.create({
  section: { marginTop: 8, gap: 12 },
  heading: { color: colors.text, fontSize: 20, fontWeight: '700', lineHeight: 28, marginTop: 12, paddingHorizontal: 4, letterSpacing: -0.4 },
  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: 20, gap: 10 },
  score: { gap: 8, paddingTop: 14, marginTop: 4, borderTopWidth: 1, borderTopColor: colors.line },
  keyLine: { color: colors.text, fontSize: 17, fontWeight: '700', lineHeight: 25 },
  todo: { gap: 4, backgroundColor: colors.fill, borderRadius: 14, padding: 14 },
  scoreCaption: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  scoreNumber: { fontSize: 26, lineHeight: 32, fontWeight: '800', letterSpacing: -0.5 },
  scoreUnit: { color: colors.textFaint, fontSize: 18, fontWeight: '700', letterSpacing: 0 },
  scoreChip: { alignSelf: 'center' },
  scoreWithheld: { color: colors.textSub, fontSize: 20, lineHeight: 28, fontWeight: '800', letterSpacing: -0.5 },
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
  partial: { backgroundColor: colors.fill, color: colors.green },
  attention: { backgroundColor: colors.orangeSoft, color: colors.orangeText },
  unknown: { backgroundColor: colors.card, color: colors.textSub },
});
