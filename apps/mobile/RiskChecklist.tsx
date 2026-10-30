import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

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

export function RiskChecklist({ analysis, sourceUrl }: { analysis: RiskAnalysis | null; sourceUrl: string }) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [showConditions, setShowConditions] = useState(false);
  const complete = analysis?.status === 'completed';
  const assessment = analysis?.assessment;
  const level = complete ? assessment?.level ?? 'undetermined' : 'undetermined';
  const levelLabel = level === 'undetermined' ? '판단 보류' : assessment?.label;
  return <View style={styles.section}>
    <Text style={styles.heading}>구매 전 주의 수준</Text>
    <View accessibilityLabel={`구매 전 주의 수준 ${levelLabel}`} style={[styles.levelCard, levelStyles[level]]}>
      <Text style={[styles.levelTitle, levelTextStyles[level]]}>{levelLabel}</Text>
      <Text style={styles.body}>{assessment?.summary ?? '주의 수준을 확인하려면 상품 자료를 추가하거나 다시 분석해 주세요.'}</Text>
      {assessment?.reasons.length ? <>
        <Text style={styles.label}>판단 근거</Text>
        {assessment.reasons.map((reason, index) => <Text key={index} style={styles.body}>• {reason}</Text>)}
      </> : null}
      {assessment?.criteria.map(criterion => <View key={criterion.key} style={styles.criterion}>
        <Text style={styles.label}>{criterion.label} · {criterion.status === 'confirmed' ? '확인됨' : criterion.status === 'attention' ? '주의 항목 있음' : '추가 확인'}</Text>
        <Text style={styles.meta}>{criterion.detail}</Text>
      </View>)}
      {assessment?.missing_checks.length ? <>
        <Text style={styles.label}>아직 확인할 정보</Text>
        <Text style={styles.body}>{assessment.missing_checks.join(' · ')}</Text>
      </> : null}
      <Text style={styles.meta}>수집한 자료에서 확인한 신호의 주의 수준입니다. 판매자 신뢰도나 사기 확률, 정품·안전을 인증하는 결과가 아닙니다.</Text>
    </View>
    <Text style={styles.heading}>구매 전 체크리스트</Text>
    <View style={[styles.summary, !complete && styles.neutral]}>
      <Text style={styles.summaryTitle}>{complete ? '수집한 상품 설명 분석' : '위험 신호 분석 미완료'}</Text>
      <Text style={styles.body}>{analysis?.message ?? '새 분석을 시작하면 상세 설명의 확인 항목을 볼 수 있어요.'}</Text>
      <Text style={styles.meta}>사기 확률이나 안전 등급이 아닙니다. 수집하지 못한 내용은 판단하지 않아요.</Text>
    </View>
    {complete ? <>
      {analysis.checklist.length > 0 ? <Text style={styles.counter}>직접 확인한 항목 {checked.size} / {analysis.checklist.length}</Text> : null}
      {analysis.checklist.map(item => <View key={item.id} style={[styles.card, item.kind === 'needs_check' && styles.missingCard]}>
        <Text style={[styles.badge, item.kind === 'needs_check' && styles.missingBadge]}>{item.kind === 'attention' ? '표현·불일치 확인' : '수집 자료에서 확인 불가'}</Text>
        <Pressable accessibilityRole="checkbox" accessibilityLabel={`${item.title} 확인 완료`}
          accessibilityState={{ checked: checked.has(item.id) }} onPress={() => setChecked(previous => {
            const next = new Set(previous); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next;
          })} style={styles.checkRow}>
          <Text style={styles.checkMark}>{checked.has(item.id) ? '☑' : '☐'}</Text>
          <Text style={styles.cardTitle}>{item.title}</Text>
        </Pressable>
        <Text style={styles.body}>{item.explanation}</Text>
        <Text style={styles.label}>원문 근거</Text>
        {item.quotes.length ? item.quotes.map((quote, index) => <Text key={index} selectable style={styles.quote}>{quote}</Text>)
          : <Text style={styles.meta}>수집한 자료에서 해당 안내를 찾지 못했습니다. 실제 페이지에서 안내를 펼쳐 확인해 주세요.</Text>}
        <Text style={styles.label}>확인 방법</Text>
        <Text style={styles.body}>{item.how_to_check}</Text>
      </View>)}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showConditions }}
        onPress={() => setShowConditions(value => !value)} style={styles.outline}>
        <Text style={styles.link}>{showConditions ? '상품 조건 원문 접기' : '상품 조건 원문 보기'}</Text>
      </Pressable>
      {showConditions ? <View style={styles.conditions}>
        {(Object.keys(labels) as (keyof RiskAnalysis['conditions'])[]).map(key => {
          const condition = analysis.conditions[key];
          return <View key={key} style={styles.condition}>
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
    {analysis?.warnings.map((warning, index) => <Text key={index} style={styles.meta}>{warning}</Text>)}
  </View>;
}

const styles = StyleSheet.create({
  section: { marginTop: 28, gap: 12 },
  heading: { color: '#172033', fontSize: 22, fontWeight: '800', lineHeight: 31 },
  levelCard: { borderRadius: 14, borderWidth: 1, padding: 18, gap: 10 },
  levelTitle: { fontSize: 30, lineHeight: 40, fontWeight: '800' },
  criterion: { borderTopWidth: 1, borderTopColor: '#CBD5E1', paddingTop: 8, gap: 3 },
  summary: { borderRadius: 12, padding: 16, backgroundColor: '#EFF6FF', gap: 8 },
  neutral: { backgroundColor: '#F1F5F9' },
  summaryTitle: { color: '#1E3A8A', fontSize: 16, fontWeight: '700', lineHeight: 24 },
  body: { color: '#334155', fontSize: 14, lineHeight: 23, flexShrink: 1 },
  meta: { color: '#64748B', fontSize: 12, lineHeight: 20 },
  counter: { color: '#475569', fontSize: 13, lineHeight: 21 },
  card: { borderRadius: 12, borderWidth: 1, borderColor: '#FCD34D', backgroundColor: '#FFFBEB', padding: 16, gap: 10 },
  missingCard: { borderColor: '#CBD5E1', backgroundColor: '#F8FAFC' },
  badge: { color: '#92400E', fontSize: 12, fontWeight: '700', lineHeight: 20 },
  missingBadge: { color: '#475569' },
  checkRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', minHeight: 44 },
  checkMark: { color: '#1D6FE8', fontSize: 23, lineHeight: 29 },
  cardTitle: { flex: 1, color: '#172033', fontSize: 16, fontWeight: '700', lineHeight: 25 },
  label: { color: '#475569', fontSize: 13, fontWeight: '700', lineHeight: 21, marginTop: 4 },
  quote: { color: '#334155', fontSize: 13, lineHeight: 22, borderLeftWidth: 2, borderLeftColor: '#CBD5E1', paddingLeft: 10 },
  outline: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, padding: 12, minHeight: 46, alignItems: 'center' },
  link: { color: '#1D4ED8', fontSize: 14, fontWeight: '600', lineHeight: 22 },
  conditions: { borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 12, paddingHorizontal: 16 },
  condition: { paddingVertical: 14, gap: 8, borderBottomColor: '#E2E8F0', borderBottomWidth: 1 },
  sourceLink: { paddingVertical: 10, alignItems: 'center' },
});

const levelStyles = StyleSheet.create({
  high: { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5' },
  moderate: { backgroundColor: '#FFFBEB', borderColor: '#FCD34D' },
  low: { backgroundColor: '#EFF6FF', borderColor: '#93C5FD' },
  undetermined: { backgroundColor: '#F1F5F9', borderColor: '#CBD5E1' },
});
const levelTextStyles = StyleSheet.create({
  high: { color: '#991B1B' }, moderate: { color: '#92400E' },
  low: { color: '#1E40AF' }, undetermined: { color: '#475569' },
});
