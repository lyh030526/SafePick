import { StyleSheet, Text, View } from 'react-native';
import { colors } from './theme';
import { Disclosure, Pill, text } from './ui';

export type SellerVerification = {
  status: 'active' | 'suspended' | 'closed' | 'unregistered' | 'invalid_number' | 'marketplace_listed' | 'platform_direct'
    | 'overseas' | 'not_found' | 'unavailable';
  label: string;
  message: string;
  seller: { business_name: string; representative: string; business_number: string;
    mail_order_number: string; address: string; quote: string };
  tax_type: string | null;
  closed_on: string | null;
  number_source?: 'page' | 'registry';
  marketplace_rating?: number | null;
  rating_count?: number | null;
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
  marketplace_listed: 'neutral', platform_direct: 'good', overseas: 'neutral', not_found: 'neutral', unavailable: 'neutral',
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
    ['마켓 판매자 평가', verification.marketplace_rating != null ? `${verification.marketplace_rating}% (${verification.rating_count}명)` : ''],
  ].filter(([, value]) => value && value !== '확인 불가');
  return <Disclosure accessibilityLabel={`판매자 사업자 확인 ${verification.label}`} title="판매자 사업자 확인" icon="business-outline"
    status={verification.label} tone={tone}>
      <Text style={text.small}>국세청 사업자 상태</Text>
      <Text style={text.body}>{verification.message}</Text>
      {verification.tax_type && verification.status !== 'unregistered' ? <Text style={text.small}>{verification.tax_type}</Text> : null}
      {rows.length ? <View style={styles.rows}>
        {rows.map(([name, value]) => <View key={name} style={styles.row}>
          <Text style={styles.rowLabel}>{name}</Text>
          <Text selectable style={styles.rowValue}>{value}</Text>
        </View>)}
      </View> : null}
      {verification.mail_order ? <MailOrder check={verification.mail_order} /> : null}
      <Text style={text.small}>판매 페이지에 표시된 사업자 정보를 국세청 등록 상태와 공정위 통신판매업 신고와 대조한 결과예요. 표시된 정보가 실제 판매자의 것인지, 판매자를 믿을 수 있는지는 보증하지 않아요.</Text>
  </Disclosure>;
}

function MailOrder({ check }: { check: NonNullable<SellerVerification['mail_order']> }) {
  const tone = mailTones[check.status];
  const rows = [
    ['신고 상호', check.registered_name], ['신고 대표자', check.registered_representative],
    ['신고번호', check.report_number], ['신고 쇼핑몰 주소', check.registered_domains.join(', ')],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  return <View accessibilityLabel={`통신판매업 신고 ${check.label}`} style={styles.mailOrder}>
    <Text style={text.small}>공정위 통신판매업 신고</Text>
    <Pill label={check.label} tone={tone} dot />
    <Text style={text.body}>{check.message}</Text>
    {rows.length ? <View style={styles.rows}>
      {rows.map(([name, value]) => <View key={name} style={styles.row}>
        <Text style={styles.rowLabel}>{name}</Text>
        <Text selectable style={styles.rowValue}>{value}</Text>
      </View>)}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  mailOrder: { gap: 8, marginTop: 4, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  rows: { backgroundColor: colors.fill, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 8 },
  rowLabel: { flexShrink: 0, color: colors.textMuted, fontSize: 14, lineHeight: 21 },
  rowValue: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600', lineHeight: 21, textAlign: 'right' },
});
