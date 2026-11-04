import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, levels, radius, type } from './theme';
import { Card, CheckCircle, Disclosure, Icon, Pill, SectionTitle, text } from './ui';

type Condition = { status: 'found' | 'unknown'; text: string; quotes: string[] };
export type RiskAnalysis = {
  status: 'completed' | 'insufficient' | 'unavailable';
  message: string;
  conditions: Record<'description' | 'components' | 'options' | 'shipping' | 'returns' | 'warranty', Condition>;
  checklist: { id: string; category: string; kind: 'attention' | 'needs_check'; title: string;
    explanation: string; quotes: string[]; how_to_check: string }[];
  warnings: string[];
  review_complaints?: { low_reviews: number; complaints: number; same_seller: number; quotes: string[] } | null;
  claim_check?: ClaimCheck | null;
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
type Level = keyof typeof levels;
export type ClaimCheck = { status: 'confirmed' | 'contradicted' | 'unverified'; label: string; message: string;
  claims: { kind: string; quote: string }[]; marks: { name: string; source: 'text' | 'image' }[]; brand_owner: string | null };
const claimTones = { confirmed: 'good', contradicted: 'warn', unverified: 'neutral' } as const;

// The page's genuineness and official claims and marks, against who the seller is; a mark alone earns nothing.
export function ClaimCard({ check }: { check: ClaimCheck | null | undefined }) {
  if (!check) return null;
  return <Disclosure accessibilityLabel={`정품·공식 판매 표시 ${check.label}`} title="정품·공식 판매 표시" icon="ribbon-outline"
    status={check.label} tone={claimTones[check.status]}>
    <Text style={text.body}>{check.message}</Text>
    {check.marks.map(mark => <View key={mark.name} style={styles.bulletRow}>
      <Icon name={mark.source === 'image' ? 'image-outline' : 'pricetag-outline'} size={16} color={colors.textMuted} />
      <Text style={[text.small, styles.flex]}>{mark.name}{mark.source === 'image' ? ' (이미지)' : ''}</Text>
    </View>)}
    {check.claims.map(claim => <Text key={claim.quote} selectable style={styles.quote}>{claim.quote}</Text>)}
  </Disclosure>;
}
const labels: Record<keyof RiskAnalysis['conditions'], string> = {
  description: '상세 설명', components: '구성품', options: '옵션', shipping: '배송 조건', returns: '반품·교환 조건', warranty: '보증·AS',
};
const criterionLabels = { confirmed: '확인됨', partial: '일부 확인', attention: '주의 항목 있음', unknown: '추가 확인' };
const criterionTones = { confirmed: 'good', partial: 'good', attention: 'warn', unknown: 'neutral' } as const;

// The verdict and the checklist together, for places that show one listing in a single block (the group comparison).
export function RiskChecklist({ analysis, sourceUrl }: { analysis: RiskAnalysis | null; sourceUrl: string }) {
  return <View style={styles.stack}>
    <Verdict analysis={analysis} />
    <Checklist analysis={analysis} sourceUrl={sourceUrl} />
  </View>;
}

function levelOf(analysis: RiskAnalysis | null): Level {
  const assessment = analysis?.assessment;
  // A closed seller or a missing domain is high, and a very new short-term domain is moderate, even when the page could
  // not be read or the description analysis did not finish.
  const decisive = assessment?.level === 'high' || assessment?.domain?.status === 'new_short';
  return analysis?.status === 'completed' || decisive ? assessment?.level ?? 'undetermined' : 'undetermined';
}

// The level and the one reason behind it come first; what to check, the evidence and the score follow.
export function Verdict({ analysis, product }: { analysis: RiskAnalysis | null; product?: string }) {
  const [showCriteria, setShowCriteria] = useState(false);
  const assessment = analysis?.assessment;
  const level = levelOf(analysis);
  const tone = levels[level];
  const decided = analysis?.status === 'completed' || level !== 'undetermined';
  const domain = assessment?.domain && !['marketplace', 'unavailable'].includes(assessment.domain.status) ? assessment.domain : null;
  const levelLabel = level === 'undetermined' ? '판단 보류' : assessment?.label;
  const line = keyLine(assessment, level);
  // The line under the level already states the first reason, so the list repeats only the rest.
  const otherReasons = (assessment?.reasons ?? []).filter(reason => reason !== line);
  return <Card style={styles.verdictCard}>
    <View accessibilityLabel={`구매 전 주의 수준 ${levelLabel}`} style={[styles.verdictHead, { backgroundColor: tone.soft }]}>
      <Text style={[styles.eyebrow, { color: tone.text }]}>구매 전 주의 수준</Text>
      <View style={styles.levelRow}>
        <Icon name={tone.icon} size={34} color={tone.color} />
        <Text style={[styles.levelTitle, { color: tone.text }]}>{levelLabel}</Text>
      </View>
      {line ? <Text style={styles.keyLine}>{line}</Text> : null}
      <Text style={text.body}>{assessment?.summary ?? '주의 수준을 확인하려면 상품 자료를 추가하거나 다시 분석해 주세요.'}</Text>
      {product ? <Text numberOfLines={1} style={text.small}>{product}</Text> : null}
    </View>
    <View style={styles.verdictBody}>
      {assessment?.missing_checks.length ? <View style={styles.block}>
        <Text style={text.strong}>구매 전에 확인할 것</Text>
        {assessment.missing_checks.map(item => <View key={item} style={styles.bulletRow}>
          <Icon name="square-outline" size={17} color={colors.textMuted} />
          <Text style={[text.body, styles.flex]}>{item}</Text>
        </View>)}
      </View> : null}
      {otherReasons.length ? <View style={styles.block}>
        <Text style={text.strong}>판단 근거</Text>
        {otherReasons.map((reason, index) => <View key={index} style={styles.bulletRow}>
          <View style={[styles.bullet, { backgroundColor: tone.color }]} />
          <Text style={[text.body, styles.flex]}>{reason}</Text>
        </View>)}
      </View> : null}
      {decided ? <ScoreSummary assessment={assessment} level={level} /> : null}
      {analysis?.review_complaints?.complaints ? <View accessibilityLabel="낮은 별점 리뷰 요약" style={styles.inset}>
        <Text style={text.strong}>낮은 별점 리뷰 (참고)</Text>
        <Text style={text.body}>1~2점 리뷰 {analysis.review_complaints.low_reviews}개 중 {analysis.review_complaints.complaints}개가
          가품·미배송·연락두절 등을 언급했고, 그중 이 판매자에 대한 리뷰는 {analysis.review_complaints.same_seller}개예요.
          한 상품의 리뷰에는 다른 판매자 리뷰가 섞여 있고 추측도 많아 주의 수준에는 반영하지 않았어요.</Text>
        {analysis.review_complaints.quotes.map((quote, index) => <Text key={index} style={text.small}>“{quote}”</Text>)}
      </View> : null}
      {domain ? <View accessibilityLabel={`도메인 ${domain.label}`} style={styles.inset}>
        <Text style={text.strong}>도메인 등록 정보</Text>
        <Text style={text.body}>{[domain.domain, domain.label, domain.registered_on && `등록 ${domain.registered_on}`,
          domain.expires_on && `만료 ${domain.expires_on}`].filter(Boolean).join(' · ')}</Text>
        <Text style={text.small}>{domain.message}</Text>
      </View> : null}
      {assessment?.criteria.length ? <>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: showCriteria }} onPress={() => setShowCriteria(!showCriteria)}
          style={({ pressed }) => [styles.more, pressed && styles.pressed]}>
          <Text style={text.link}>{showCriteria ? '판단 기준 접기' : '판단 기준 자세히 보기'}</Text>
          <Icon name={showCriteria ? 'chevron-up' : 'chevron-down'} size={16} color={colors.brandText} />
        </Pressable>
        {showCriteria ? <View style={styles.inset}>
          {assessment.criteria.map(criterion => <View key={criterion.key} style={styles.criterion}>
            <View style={styles.criterionHead}>
              <Text style={[text.strong, styles.flex]}>{criterion.label}</Text>
              <Pill label={criterionLabels[criterion.status]} tone={criterionTones[criterion.status]} />
            </View>
            <Text style={text.small}>{criterion.detail}</Text>
          </View>)}
        </View> : null}
      </> : null}
      <Text style={text.small}>신뢰 점수는 확인한 근거로 계산한 참고 점수이고, 주의 수준은 수집한 자료에서 확인한 신호예요. 사기 확률이 아니며 판매자나 정품·안전을 인증하지 않아요.</Text>
    </View>
  </Card>;
}

// Items the shopper ticks off while checking the real page, with the quote each one came from.
export function Checklist({ analysis, sourceUrl }: { analysis: RiskAnalysis | null; sourceUrl: string }) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [showConditions, setShowConditions] = useState(false);
  const complete = analysis?.status === 'completed';
  const total = complete ? analysis.checklist.length : 0;
  return <View style={styles.stack}>
    <SectionTitle>구매 전 체크리스트</SectionTitle>
    <Card style={[styles.summary, !complete && styles.summaryNeutral]}>
      <View style={styles.bulletRow}>
        <Icon name={complete ? 'sparkles-outline' : 'hourglass-outline'} size={18} color={complete ? colors.brandText : colors.textMuted} />
        <Text style={[text.strong, styles.flex]}>{complete ? '수집한 상품 설명 분석' : '위험 신호 분석 미완료'}</Text>
      </View>
      <Text style={text.body}>{analysis?.message ?? '새 분석을 시작하면 상세 설명의 확인 항목을 볼 수 있어요.'}</Text>
    </Card>
    {complete ? <>
      {total > 0 ? <View style={styles.progress}>
        <Text style={styles.counter}>직접 확인한 항목 {checked.size} / {total}</Text>
        <View style={styles.track}><View style={[styles.fill, { width: `${(checked.size / total) * 100}%` }]} /></View>
      </View> : null}
      {analysis.checklist.map(item => <Card key={item.id}>
        <Pill label={item.kind === 'attention' ? '표현·불일치 확인' : '수집 자료에서 확인 불가'} tone={item.kind === 'attention' ? 'warn' : 'neutral'} />
        <Pressable accessibilityRole="checkbox" accessibilityLabel={`${item.title} 확인 완료`}
          accessibilityState={{ checked: checked.has(item.id) }} onPress={() => setChecked(previous => {
            const next = new Set(previous); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next;
          })} style={styles.checkRow}>
          <CheckCircle checked={checked.has(item.id)} />
          <Text style={[styles.itemTitle, checked.has(item.id) && styles.itemDone]}>{item.title}</Text>
        </Pressable>
        <Text style={text.body}>{item.explanation}</Text>
        {item.quotes.length ? item.quotes.map((quote, index) => <Text key={index} selectable style={styles.quote}>{quote}</Text>)
          : <Text style={text.small}>수집한 자료에서 해당 안내를 찾지 못했어요. 실제 페이지에서 안내를 펼쳐 확인해 주세요.</Text>}
        <View style={styles.howTo}>
          <Icon name="checkmark-done-outline" size={17} color={colors.brandText} />
          <Text style={[text.body, styles.flex]}>{item.how_to_check}</Text>
        </View>
      </Card>)}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showConditions }}
        onPress={() => setShowConditions(value => !value)} style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}>
        <Text style={styles.toggleText}>{showConditions ? '상품 조건 원문 접기' : '상품 조건 원문 보기'}</Text>
        <Icon name={showConditions ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSub} />
      </Pressable>
      {showConditions ? <Card>
        {(Object.keys(labels) as (keyof RiskAnalysis['conditions'])[]).map((key, index) => {
          const condition = analysis.conditions[key];
          return <View key={key} style={[styles.condition, index > 0 && styles.conditionDivider]}>
            <Text style={text.strong}>{labels[key]}</Text>
            <Text selectable style={text.body}>{condition.text}</Text>
            {condition.status === 'unknown' && condition.quotes.map((quote, index) => <Text key={index} selectable style={styles.quote}>{quote}</Text>)}
          </View>;
        })}
      </Card> : null}
      <Pressable accessibilityRole="link" onPress={() => Linking.openURL(sourceUrl)} style={styles.sourceLink}>
        <Icon name="open-outline" size={16} color={colors.brandText} />
        <Text style={text.link}>분석한 판매 페이지 열기</Text>
      </Pressable>
    </> : null}
    {analysis?.warnings.map((warning, index) => <Text key={index} style={[text.small, styles.warning]}>{warning}</Text>)}
  </View>;
}

// The single line under the level: why it is high or moderate, what is still missing when it is held back.
function keyLine(assessment: RiskAnalysis['assessment'], level: string) {
  if (!assessment) return '';
  if (level === 'undetermined' && assessment.missing_checks.length) return `더 확인할 것: ${assessment.missing_checks.slice(0, 2).join(', ')}`;
  return assessment.reasons[0] ?? '';
}

function ScoreSummary({ assessment, level }: { assessment: RiskAnalysis['assessment']; level: Level }) {
  if (!assessment || assessment.coverage_percent === undefined) return null;
  const coverage = assessment.coverage_percent;
  const total = assessment.criteria.length;
  const scored = assessment.score !== null && assessment.score !== undefined;
  return <View accessibilityLabel={scored ? `신뢰 점수 ${assessment.score}점 ${assessment.score_label}` : '신뢰 점수 보류'} style={styles.score}>
    <View style={styles.scoreRow}>
      <Text style={text.strong}>신뢰 점수</Text>
      {scored ? <Text style={[styles.scoreNumber, { color: levels[level].text }]}>{assessment.score}<Text style={styles.scoreUnit}> / 100</Text></Text>
        : <Text style={styles.scoreWithheld}>점수 보류</Text>}
    </View>
    <View style={styles.track}><View style={[styles.fill, { width: `${coverage}%`, backgroundColor: levels[level].color }]} /></View>
    <Text style={text.small}>
      {scored ? `${assessment.score_label} · ` : ''}근거 확인 {assessment.checked_count ?? 0} / {total}개
      {scored ? '' : ' · 확인된 근거가 부족해 점수를 매기지 않았어요'}
    </Text>
  </View>;
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  flex: { flex: 1 },
  verdictCard: { padding: 0, gap: 0, overflow: 'hidden' },
  verdictHead: { padding: 20, gap: 8 },
  eyebrow: { fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
  levelRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  levelTitle: { ...type.display, fontSize: 32, lineHeight: 40 },
  keyLine: { ...type.heading, color: colors.text },
  verdictBody: { padding: 20, gap: 16 },
  block: { gap: 8 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 8 },
  inset: { backgroundColor: colors.fill, borderRadius: 14, padding: 14, gap: 8 },
  more: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 4 },
  criterion: { gap: 4 },
  criterionHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  score: { gap: 8 },
  scoreRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  scoreNumber: { fontSize: 24, lineHeight: 30, fontWeight: '800', letterSpacing: -0.5 },
  scoreUnit: { color: colors.textFaint, fontSize: 15, fontWeight: '700', letterSpacing: 0 },
  scoreWithheld: { color: colors.textSub, fontSize: 18, fontWeight: '800' },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.brand },
  summary: { backgroundColor: colors.brandSoft, shadowOpacity: 0, elevation: 0 },
  summaryNeutral: { backgroundColor: colors.card },
  progress: { gap: 8, paddingHorizontal: 4 },
  counter: { color: colors.textSub, fontSize: 14, fontWeight: '600' },
  checkRow: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 44 },
  itemTitle: { ...type.heading, flex: 1, color: colors.text },
  itemDone: { color: colors.textMuted, textDecorationLine: 'line-through' },
  quote: { ...type.small, fontSize: 14, color: colors.textSub, backgroundColor: colors.fill, borderRadius: 12, padding: 12,
    borderLeftWidth: 3, borderLeftColor: colors.line },
  howTo: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: colors.brandSoft, borderRadius: 12, padding: 12 },
  toggle: { flexDirection: 'row', gap: 6, backgroundColor: colors.card, borderRadius: radius.button, minHeight: 50,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line },
  toggleText: { color: colors.textSub, fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  condition: { paddingVertical: 4, gap: 6 },
  conditionDivider: { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14 },
  sourceLink: { flexDirection: 'row', gap: 6, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  warning: { paddingHorizontal: 4 },
});
