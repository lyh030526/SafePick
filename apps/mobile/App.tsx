import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

type AnalysisState = 'input' | 'loading' | 'correction';

type ProductDetails = {
  brand_name: string;
  product_name: string;
  model_number: string;
  price: string;
  currency: string;
  seller_name: string;
  components: string[];
};

type AnalysisResponse = {
  status: 'completed' | 'manual_input_required';
  product: ProductDetails;
  source: { page_title: string; final_url: string; text_length: number };
  warnings: string[];
  official_lookup: OfficialLookup;
};

type OfficialLookup = {
  status: 'found' | 'not_supported' | 'no_results' | 'unavailable';
  brand: { name: string; domains: string[] } | null;
  query: string | null;
  results: Array<{ title: string; url: string; snippet: string }>;
  message: string;
};

const sampleLink =
  'https://www.coupang.com/vp/products/7608804797?itemId=20146298818';
const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

const fieldLabels: Array<{ key: keyof Omit<ProductDetails, 'components'>; label: string }> = [
  { key: 'brand_name', label: '브랜드명' },
  { key: 'product_name', label: '상품명' },
  { key: 'model_number', label: '모델명' },
  { key: 'price', label: '판매 가격' },
  { key: 'currency', label: '통화' },
  { key: 'seller_name', label: '판매처' },
];

export default function App() {
  const [productUrl, setProductUrl] = useState('');
  const [error, setError] = useState('');
  const [analysisState, setAnalysisState] = useState<AnalysisState>('input');
  const [product, setProduct] = useState<ProductDetails | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [officialLookup, setOfficialLookup] = useState<OfficialLookup | null>(null);

  const startAnalysis = async () => {
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(productUrl.trim());
    } catch {
      setError('상품 페이지의 전체 링크를 입력해 주세요.');
      return;
    }

    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      setError('http 또는 https로 시작하는 링크만 분석할 수 있어요.');
      return;
    }

    setError('');
    setAnalysisState('loading');

    try {
      const response = await fetch(`${apiBaseUrl}/analyses`, {
        body: JSON.stringify({ product_url: parsedUrl.toString() }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const payload = (await response.json()) as AnalysisResponse | { detail?: string };

      if (!response.ok || !('product' in payload)) {
        throw new Error('detail' in payload ? payload.detail : '분석 요청에 실패했습니다.');
      }

      setProduct(payload.product);
      setWarnings(payload.warnings);
      setOfficialLookup(payload.official_lookup);
      setAnalysisState('correction');
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : '분석 서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.',
      );
      setAnalysisState('input');
    }
  };

  if (analysisState === 'loading') {
    return <AnalysisProgress onCancel={() => setAnalysisState('input')} />;
  }

  if (analysisState === 'correction' && product) {
    return (
      <CorrectionForm
        initialProduct={product}
        officialLookup={officialLookup}
        warnings={warnings}
        onBack={() => setAnalysisState('input')}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardContainer}
      >
        <View style={styles.content}>
          <BrandHeader />
          <View style={styles.hero}>
            <Text style={styles.eyebrow}>구매 전 확인</Text>
            <Text style={styles.title}>상품 링크로{`\n`}위험 요소를 확인하세요</Text>
            <Text style={styles.description}>
              판매 페이지 정보와 공식 사이트 정보를 비교해 구매 전 확인할 항목을 알려드려요.
            </Text>
          </View>

          <View style={styles.inputSection}>
            <Text style={styles.label}>상품 링크</Text>
            <TextInput
              accessibilityLabel="상품 링크"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onChangeText={(value) => {
                setProductUrl(value);
                if (error) setError('');
              }}
              placeholder="https://shopping.example.com/product/..."
              placeholderTextColor="#94A3B8"
              style={[styles.input, error ? styles.inputError : undefined]}
              value={productUrl}
            />
            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <Pressable
              accessibilityRole="button"
              onPress={startAnalysis}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            >
              <Text style={styles.primaryButtonText}>분석 시작</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => setProductUrl(sampleLink)}
              style={({ pressed }) => [styles.sampleButton, pressed && styles.pressed]}
            >
              <Text style={styles.sampleButtonText}>예시 링크로 채우기</Text>
            </Pressable>
          </View>

          <View style={styles.noticeCard}>
            <Text style={styles.noticeTitle}>지원 브랜드 기준 분석</Text>
            <Text style={styles.noticeBody}>
              초기 버전은 삼성전자, Apple, LG전자, 다이슨, 소니코리아의 공식 정보를 우선 비교합니다.
            </Text>
          </View>

          <Text style={styles.disclaimer}>
            세이프픽은 사기 여부를 단정하지 않으며, 구매 전 확인이 필요한 근거를 제공합니다.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function BrandHeader() {
  return (
    <View style={styles.brandRow}>
      <View style={styles.logoMark}>
        <Text style={styles.logoText}>S</Text>
      </View>
      <Text style={styles.appName}>SafePick</Text>
    </View>
  );
}

function AnalysisProgress({ onCancel }: { onCancel: () => void }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={[styles.content, styles.progressContent]}>
        <BrandHeader />
        <View style={styles.progressHero}>
          <ActivityIndicator color="#1D6FE8" size="large" />
          <Text style={styles.progressTitle}>상품을 분석하고 있어요</Text>
          <Text style={styles.progressDescription}>
            판매 페이지의 공개 정보를 읽고 필요한 항목을 정리하고 있습니다.
          </Text>
        </View>
        <View style={styles.stepsCard}>
          <AnalysisStep label="링크 형식 확인" active />
          <AnalysisStep label="판매 페이지 정보 추출" active />
          <AnalysisStep label="누락 정보 확인" />
        </View>
        <Pressable onPress={onCancel} style={styles.cancelButton}>
          <Text style={styles.cancelButtonText}>링크 입력으로 돌아가기</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function CorrectionForm({
  initialProduct,
  officialLookup,
  warnings,
  onBack,
}: {
  initialProduct: ProductDetails;
  officialLookup: OfficialLookup | null;
  warnings: string[];
  onBack: () => void;
}) {
  const [draft, setDraft] = useState(initialProduct);
  const [saved, setSaved] = useState(false);

  const updateField = (key: keyof ProductDetails, value: string) => {
    setSaved(false);
    if (key === 'components') {
      setDraft({ ...draft, components: value ? value.split(',').map((item) => item.trim()) : ['확인 불가'] });
      return;
    }
    setDraft({ ...draft, [key]: value });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboardContainer}>
        <ScrollView contentContainerStyle={styles.correctionContent} keyboardShouldPersistTaps="handled">
          <BrandHeader />
          <Text style={styles.correctionTitle}>추출 정보 확인</Text>
          <Text style={styles.correctionDescription}>
            자동 추출 결과를 확인하고, 비어 있거나 다른 항목은 직접 수정해 주세요.
          </Text>

          {warnings.length > 0 ? (
            <View style={styles.warningCard}>
              <Text style={styles.warningTitle}>직접 확인이 필요해요</Text>
              {warnings.map((warning) => (
                <Text key={warning} style={styles.warningText}>• {warning}</Text>
              ))}
            </View>
          ) : null}

          {officialLookup ? <OfficialLookupCard lookup={officialLookup} /> : null}

          <View style={styles.formCard}>
            {fieldLabels.map(({ key, label }) => (
              <EditableField
                key={key}
                label={label}
                onChangeText={(value) => updateField(key, value)}
                value={draft[key]}
              />
            ))}
            <EditableField
              label="구성품 (쉼표로 구분)"
              onChangeText={(value) => updateField('components', value)}
              value={draft.components.join(', ')}
            />
          </View>

          {saved ? <Text style={styles.savedText}>수정한 정보가 적용되었습니다.</Text> : null}
          <Pressable
            onPress={() => setSaved(true)}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.primaryButtonText}>수정 내용 적용</Text>
          </Pressable>
          <Pressable onPress={onBack} style={styles.cancelButton}>
            <Text style={styles.cancelButtonText}>다른 링크 분석하기</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function OfficialLookupCard({ lookup }: { lookup: OfficialLookup }) {
  return (
    <View style={styles.officialCard}>
      <Text style={styles.officialTitle}>공식 정보 비교</Text>
      <Text style={styles.officialMessage}>{lookup.message}</Text>
      {lookup.brand ? (
        <Text style={styles.officialMeta}>
          {lookup.brand.name} 공식 도메인: {lookup.brand.domains.join(', ')}
        </Text>
      ) : null}
      {lookup.query ? <Text style={styles.officialMeta}>검색어: {lookup.query}</Text> : null}
      {lookup.results.map((result) => (
        <Pressable key={result.url} onPress={() => Linking.openURL(result.url)} style={styles.searchResult}>
          <Text numberOfLines={2} style={styles.searchResultTitle}>{result.title}</Text>
          {result.snippet ? <Text numberOfLines={2} style={styles.searchResultSnippet}>{result.snippet}</Text> : null}
          <Text numberOfLines={1} style={styles.searchResultUrl}>{result.url}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function EditableField({
  label,
  onChangeText,
  value,
}: {
  label: string;
  onChangeText: (value: string) => void;
  value: string;
}) {
  const needsInput = value === '확인 불가';
  return (
    <View style={styles.fieldGroup}>
      <View style={styles.fieldLabelRow}>
        <Text style={styles.label}>{label}</Text>
        {needsInput ? <Text style={styles.needsInput}>입력 필요</Text> : null}
      </View>
      <TextInput
        onChangeText={onChangeText}
        placeholder="확인 불가"
        placeholderTextColor="#94A3B8"
        style={[styles.input, needsInput && styles.inputNeedsInput]}
        value={value}
      />
    </View>
  );
}

function AnalysisStep({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <View style={styles.stepRow}>
      <View style={[styles.stepDot, active && styles.stepDotActive]} />
      <Text style={[styles.stepLabel, active && styles.stepLabelActive]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFFFFF' },
  keyboardContainer: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  correctionContent: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40 },
  brandRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  logoMark: { alignItems: 'center', backgroundColor: '#1D6FE8', borderRadius: 8, height: 30, justifyContent: 'center', width: 30 },
  logoText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  appName: { color: '#172033', fontSize: 20, fontWeight: '700' },
  hero: { marginTop: 62 },
  eyebrow: { color: '#1D6FE8', fontSize: 14, fontWeight: '700', marginBottom: 10 },
  title: { color: '#172033', fontSize: 30, fontWeight: '800', lineHeight: 40 },
  description: { color: '#64748B', fontSize: 15, lineHeight: 23, marginTop: 16 },
  inputSection: { marginTop: 38 },
  label: { color: '#334155', fontSize: 14, fontWeight: '700', marginBottom: 9 },
  input: { borderColor: '#CBD5E1', borderRadius: 10, borderWidth: 1, color: '#172033', fontSize: 14, minHeight: 52, paddingHorizontal: 15 },
  inputError: { borderColor: '#E5484D' },
  inputNeedsInput: { borderColor: '#F59E0B', backgroundColor: '#FFFBEB' },
  errorText: { color: '#C72D37', fontSize: 13, marginTop: 8 },
  primaryButton: { alignItems: 'center', backgroundColor: '#1D6FE8', borderRadius: 10, marginTop: 14, minHeight: 54, justifyContent: 'center' },
  primaryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  sampleButton: { alignItems: 'center', marginTop: 16, paddingVertical: 9 },
  sampleButtonText: { color: '#475569', fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.78 },
  noticeCard: { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE', borderRadius: 12, borderWidth: 1, marginTop: 30, padding: 16 },
  noticeTitle: { color: '#1E3A8A', fontSize: 15, fontWeight: '800' },
  noticeBody: { color: '#475569', fontSize: 13, lineHeight: 20, marginTop: 7 },
  disclaimer: { color: '#94A3B8', fontSize: 12, lineHeight: 18, marginTop: 'auto', paddingBottom: 22 },
  progressContent: { paddingTop: 24 },
  progressHero: { alignItems: 'center', marginTop: 94 },
  progressTitle: { color: '#172033', fontSize: 26, fontWeight: '800', marginTop: 28 },
  progressDescription: { color: '#64748B', fontSize: 15, lineHeight: 23, marginTop: 12, textAlign: 'center' },
  stepsCard: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: 12, borderWidth: 1, marginTop: 46, padding: 18, rowGap: 19 },
  stepRow: { alignItems: 'center', flexDirection: 'row', gap: 11 },
  stepDot: { backgroundColor: '#D6DEE9', borderRadius: 5, height: 10, width: 10 },
  stepDotActive: { backgroundColor: '#1D6FE8' },
  stepLabel: { color: '#94A3B8', fontSize: 15, fontWeight: '600' },
  stepLabelActive: { color: '#1D6FE8' },
  cancelButton: { alignItems: 'center', marginTop: 18, padding: 12 },
  cancelButtonText: { color: '#64748B', fontSize: 14, fontWeight: '600' },
  correctionTitle: { color: '#172033', fontSize: 26, fontWeight: '800', marginTop: 38 },
  correctionDescription: { color: '#64748B', fontSize: 15, lineHeight: 23, marginTop: 10 },
  warningCard: { backgroundColor: '#FFFBEB', borderColor: '#FCD34D', borderRadius: 12, borderWidth: 1, marginTop: 22, padding: 15 },
  warningTitle: { color: '#92400E', fontSize: 15, fontWeight: '800', marginBottom: 7 },
  warningText: { color: '#A16207', fontSize: 13, lineHeight: 19 },
  officialCard: { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE', borderRadius: 12, borderWidth: 1, marginTop: 18, padding: 15 },
  officialTitle: { color: '#1E3A8A', fontSize: 15, fontWeight: '800' },
  officialMessage: { color: '#334155', fontSize: 13, lineHeight: 19, marginTop: 7 },
  officialMeta: { color: '#64748B', fontSize: 12, lineHeight: 18, marginTop: 6 },
  searchResult: { borderTopColor: '#BFDBFE', borderTopWidth: 1, marginTop: 12, paddingTop: 12 },
  searchResultTitle: { color: '#1D4ED8', fontSize: 14, fontWeight: '700', lineHeight: 20 },
  searchResultSnippet: { color: '#475569', fontSize: 12, lineHeight: 18, marginTop: 4 },
  searchResultUrl: { color: '#2563EB', fontSize: 11, marginTop: 5 },
  formCard: { marginTop: 24, rowGap: 16 },
  fieldGroup: { gap: 0 },
  fieldLabelRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  needsInput: { color: '#B45309', fontSize: 12, fontWeight: '700', marginBottom: 9 },
  savedText: { color: '#15803D', fontSize: 14, fontWeight: '700', marginTop: 18, textAlign: 'center' },
});
