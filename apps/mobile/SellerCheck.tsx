import { StyleSheet, Text, View } from 'react-native';
import { colors, radius } from './theme';

export type SellerVerification = {
  status: 'active' | 'suspended' | 'closed' | 'unregistered' | 'invalid_number' | 'marketplace_listed' | 'not_found'
    | 'unavailable';
  label: string;
  message: string;
  seller: { business_name: string; representative: string; business_number: string;
    mail_order_number: string; address: string; quote: string };
  tax_type: string | null;
  closed_on: string | null;
  number_source?: 'page' | 'registry';
  mail_order?: {
    status: 'matched' | 'name_absent' | 'domain_differs' | 'mismatch' | 'closed' | 'not_found' | 'unavailable';
    label: string;
    message: string;
    registered_name: string | null;
    registered_representative: string | null;
    report_number: string | null;
    registered_domains: string[];
  } | null;
};

const tones = {
  active: 'good', suspended: 'warn', invalid_number: 'warn', closed: 'bad', unregistered: 'bad',
  marketplace_listed: 'neutral', not_found: 'neutral', unavailable: 'neutral',
} as const;
const mailTones = {
  matched: 'good', name_absent: 'warn', domain_differs: 'warn', not_found: 'warn', mismatch: 'bad', closed: 'bad', unavailable: 'neutral',
} as const;

export function SellerCheck({ verification }: { verification: SellerVerification | null }) {
  if (!verification) return null;
  const tone = tones[verification.status];
  const { seller } = verification;
  const rows = [
    ['상호', seller.business_name], ['대표자', seller.representative], [verification.number_source === 'registry' ? '사업자등록번호 (상호·대표자로 찾음)' : '사업자등록번호', seller.business_number],
    ['통신판매업 신고번호', seller.mail_order_number], ['사업장 소재지', seller.address],
  ].filter(([, value]) => value && value !== '확인 불가');
  return <View style={styles.section}>
    <Text style={styles.heading}>판매자 사업자 확인</Text>
    <View accessibilityLabel={`판매자 사업자 확인 ${verification.label}`} style={styles.card}>
      <View style={[styles.pill, pillStyles[tone]]}>
        <View style={[styles.dot, dotStyles[tone]]} />
        <Text style={[styles.pillText, textStyles[tone]]}>국세청 사업자 상태</Text>
      </View>
      <Text style={styles.label}>{verification.label}</Text>
      <Text style={styles.body}>{verification.message}</Text>
      {verification.tax_type && verification.status !== 'unregistered' ? <Text style={styles.meta}>{verification.tax_type}</Text> : null}
      {rows.length ? <View style={styles.rows}>
        {rows.map(([name, value]) => <View key={name} style={styles.row}>
          <Text style={styles.rowLabel}>{name}</Text>
          <Text selectable style={styles.rowValue}>{value}</Text>
        </View>)}
      </View> : null}
      {verification.mail_order ? <MailOrder check={verification.mail_order} /> : null}
      <Text style={styles.meta}>판매 페이지에 표시된 사업자 정보를 국세청 등록 상태와 공정위 통신판매업 신고와 대조한 결과입니다. 표시된 정보가 실제 판매자의 것인지, 판매자를 믿을 수 있는지는 보증하지 않습니다.</Text>
    </View>
  </View>;
}

function MailOrder({ check }: { check: NonNullable<SellerVerification['mail_order']> }) {
  const tone = mailTones[check.status];
  const rows = [
    ['신고 상호', check.registered_name], ['신고 대표자', check.registered_representative],
    ['신고번호', check.report_number], ['신고 쇼핑몰 주소', check.registered_domains.join(', ')],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  return <View accessibilityLabel={`통신판매업 신고 ${check.label}`} style={styles.mailOrder}>
    <View style={[styles.pill, pillStyles[tone]]}>
      <View style={[styles.dot, dotStyles[tone]]} />
      <Text style={[styles.pillText, textStyles[tone]]}>공정위 통신판매업 신고</Text>
    </View>
    <Text style={styles.subLabel}>{check.label}</Text>
    <Text style={styles.body}>{check.message}</Text>
    {rows.length ? <View style={styles.rows}>
      {rows.map(([name, value]) => <View key={name} style={styles.row}>
        <Text style={styles.rowLabel}>{name}</Text>
        <Text selectable style={styles.rowValue}>{value}</Text>
      </View>)}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12, marginTop: 8 },
  heading: { color: colors.text, fontSize: 20, fontWeight: '700', lineHeight: 28, marginTop: 12, paddingHorizontal: 4, letterSpacing: -0.4 },
  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: 20, gap: 8 },
  pill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { fontSize: 13, fontWeight: '700' },
  label: { color: colors.text, fontSize: 24, fontWeight: '800', lineHeight: 32, letterSpacing: -0.5, marginTop: 4 },
  body: { color: colors.textSub, fontSize: 15, lineHeight: 23 },
  meta: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  mailOrder: { gap: 8, marginTop: 8, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.line },
  subLabel: { color: colors.text, fontSize: 18, fontWeight: '800', lineHeight: 26, letterSpacing: -0.3 },
  rows: { backgroundColor: colors.fill, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 6, marginTop: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 8 },
  rowLabel: { flexShrink: 0, color: colors.textMuted, fontSize: 14, lineHeight: 21 },
  rowValue: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600', lineHeight: 21, textAlign: 'right' },
});

const pillStyles = StyleSheet.create({
  good: { backgroundColor: colors.greenSoft }, warn: { backgroundColor: colors.orangeSoft },
  bad: { backgroundColor: colors.redSoft }, neutral: { backgroundColor: colors.fill },
});
const dotStyles = StyleSheet.create({
  good: { backgroundColor: colors.green }, warn: { backgroundColor: colors.orange },
  bad: { backgroundColor: colors.red }, neutral: { backgroundColor: colors.textFaint },
});
const textStyles = StyleSheet.create({
  good: { color: colors.green }, warn: { color: colors.orangeText },
  bad: { color: colors.red }, neutral: { color: colors.textSub },
});
