import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { parseBrowserImport } from './browserImport';
import { RiskChecklist, type RiskAnalysis } from './RiskChecklist';

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
  source: SourceSummary;
  warnings: string[];
  official_lookup: OfficialLookup;
  comparison: ProductComparison | null;
  risk_analysis?: RiskAnalysis;
  sale_text?: string;
};

type SourceSummary = {
  page_title: string; final_url: string; text_length: number;
  kind?: 'server_page' | 'user_text' | 'browser_extension' | 'user_images' | 'mixed';
  image_count?: number; captured_at?: string | null;
};
type AttachedImage = { uri: string; base64_data: string; mime_type: 'image/jpeg' | 'image/png' | 'image/webp'; name: string };

type ProductComparison = {
  status: 'exact' | 'similar' | 'not_found' | 'unknown';
  label: string;
  message: string;
  selected_url: string | null;
  pages: {
    url: string; title: string;
    facts: {
      product_name: string; model_number: string; price: string; currency: string;
      seller_guidance: string; match: string;
      evidence: { field: string; quote: string }[];
    };
  }[];
  price: {
    status: 'available' | 'unavailable'; sale_price: string | null; official_price: string | null;
    currency: string | null; difference: string | null; difference_percent: string | null; message: string;
  };
  seller_status: 'official_domain' | 'unknown';
  seller_message: string;
  warnings: string[];
};

type OfficialLookup = {
  status: 'found' | 'not_supported' | 'no_results' | 'unavailable';
  brand: { name: string; domains: string[] } | null;
  query: string | null;
  results: { title: string; url: string; snippet: string }[];
  message: string;
};

const sampleLink =
  'https://www.coupang.com/vp/products/7608804797?itemId=20146298818';
const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';
// The server bounds each step; this only stops the screen from waiting forever.
const requestTimeoutMs = 150_000;
const timeoutMessage = '분석 시간이 너무 오래 걸려 중단했어요. 잠시 후 다시 시도하거나 상품 설명을 직접 붙여넣어 주세요.';

const fieldLabels: { key: keyof Omit<ProductDetails, 'components'>; label: string }[] = [
  { key: 'brand_name', label: '브랜드명' },
  { key: 'product_name', label: '상품명' },
  { key: 'model_number', label: '모델명' },
  { key: 'price', label: '판매 가격' },
  { key: 'currency', label: '통화' },
  { key: 'seller_name', label: '판매처' },
];

function initialBrowserImport() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return { payload: null, error: '' };
  try { return { payload: parseBrowserImport(window.location.hash), error: '' }; }
  catch (error) { return { payload: null, error: error instanceof Error ? error.message : '상품 정보를 불러오지 못했습니다.' }; }
}

export default function App() {
  const [initialImport] = useState(initialBrowserImport);
  const [productUrl, setProductUrl] = useState(initialImport.payload?.product_url ?? '');
  const [error, setError] = useState(initialImport.error);
  const [analysisState, setAnalysisState] = useState<AnalysisState>('input');
  const [product, setProduct] = useState<ProductDetails | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [officialLookup, setOfficialLookup] = useState<OfficialLookup | null>(null);
  const [comparison, setComparison] = useState<ProductComparison | null>(null);
  const [riskAnalysis, setRiskAnalysis] = useState<RiskAnalysis | null>(null);
  const [analysisText, setAnalysisText] = useState('');
  const [providedText, setProvidedText] = useState(initialImport.payload?.provided_text ?? '');
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [inputSource, setInputSource] = useState<'user_text' | 'browser_extension'>(initialImport.payload?.input_source ?? 'user_text');
  const [pageTitle, setPageTitle] = useState(initialImport.payload?.page_title ?? '');
  const [capturedAt, setCapturedAt] = useState<string | undefined>(initialImport.payload?.captured_at);
  const [consent, setConsent] = useState(false);
  const [source, setSource] = useState<SourceSummary | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (window.location.hash.startsWith('#safepick-import=')) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  const chooseImage = async () => {
    if (images.length >= 3) { setError('이미지는 최대 3장까지 첨부할 수 있어요.'); return; }
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.85 });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      let data = asset.base64;
      let mime = Platform.OS === 'web' ? asset.mimeType : 'image/jpeg';
      if (Platform.OS === 'web' && asset.file) {
        if (asset.file.size > 4 * 1024 * 1024) throw new Error('이미지는 한 장에 4MB 이하여야 해요. 필요한 부분을 잘라 주세요.');
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다.')); reader.readAsDataURL(asset.file!);
        });
        data = dataUrl.split(',')[1]; mime = asset.file.type;
      }
      if (!data) throw new Error('이미지를 읽지 못했습니다. 다른 파일을 선택해 주세요.');
      mime = data.startsWith('/9j/') ? 'image/jpeg' : data.startsWith('iVBORw0KGgo') ? 'image/png'
        : data.startsWith('UklGR') ? 'image/webp' : mime;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime ?? '')) throw new Error('JPG, PNG, WebP 이미지를 첨부해 주세요.');
      if (data.length > 5592408) throw new Error('이미지는 한 장에 4MB 이하여야 해요. 필요한 부분을 잘라 주세요.');
      if (images.reduce((sum, image) => sum + image.base64_data.length, data.length) > 11184816) {
        throw new Error('이미지는 합계 8MB 이내로 첨부해 주세요.');
      }
      const image: AttachedImage = { uri: `data:${mime};base64,${data}`, base64_data: data,
        mime_type: mime as AttachedImage['mime_type'], name: asset.fileName || `상품 이미지 ${images.length + 1}` };
      setImages(current => [...current, image].slice(0, 3)); setConsent(false); setError('');
    } catch (error) { setError(error instanceof Error ? error.message : '이미지를 첨부하지 못했습니다.'); }
  };

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
    const hasProvidedData = !!providedText.trim() || images.length > 0;
    if (hasProvidedData && !consent) { setError('상품 자료의 AI 분석 동의를 확인해 주세요.'); return; }

    setError('');
    setAnalysisState('loading');
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, requestTimeoutMs);

    try {
      const response = await fetch(`${apiBaseUrl}/analyses`, {
        body: JSON.stringify({ product_url: parsedUrl.toString(),
          ...(hasProvidedData ? { provided_text: providedText.trim() || undefined, page_title: pageTitle,
            input_source: inputSource, captured_at: capturedAt,
            images: images.map(({ base64_data, mime_type }) => ({ base64_data, mime_type })) } : {}),
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: controller.signal,
      });
      const payload = (await response.json()) as AnalysisResponse | { detail?: string };

      if (!response.ok || !('product' in payload)) {
        const detail = 'detail' in payload ? payload.detail : null;
        throw new Error(typeof detail === 'string' ? detail : '입력한 링크·설명·이미지의 형식과 크기를 확인해 주세요.');
      }

      setProduct(payload.product);
      setWarnings(payload.warnings);
      setOfficialLookup(payload.official_lookup);
      setComparison(payload.comparison);
      setRiskAnalysis(payload.risk_analysis ?? null);
      setAnalysisText(payload.sale_text ?? providedText.trim());
      setSource(payload.source);
      setAnalysisState('correction');
    } catch (requestError) {
      if (controller.signal.aborted && !timedOut) return;
      setError(
        timedOut ? timeoutMessage : requestError instanceof Error
          ? requestError.message
          : '분석 서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.',
      );
      setAnalysisState('input');
    } finally {
      clearTimeout(timer);
    }
  };

  if (analysisState === 'loading') {
    return <AnalysisProgress onCancel={() => { requestRef.current?.abort(); setAnalysisState('input'); }} />;
  }

  if (analysisState === 'correction' && product) {
    return (
      <CorrectionForm
        initialProduct={product}
        officialLookup={officialLookup}
        initialComparison={comparison}
        initialRiskAnalysis={riskAnalysis}
        saleText={analysisText}
        productUrl={productUrl.trim()}
        warnings={warnings}
        source={source}
        onAddMaterial={() => { setConsent(false); setAnalysisState('input'); }}
        onBack={() => {
          setProductUrl(''); setProvidedText(''); setImages([]); setPageTitle('');
          setInputSource('user_text'); setCapturedAt(undefined); setConsent(false);
          setError(''); setSource(null); setRiskAnalysis(null); setAnalysisText(''); setAnalysisState('input');
        }}
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
        <ScrollView contentContainerStyle={styles.inputContent} keyboardShouldPersistTaps="handled">
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
                setInputSource('user_text'); setCapturedAt(undefined); setPageTitle(''); setConsent(false);
                if (error) setError('');
              }}
              placeholder="https://shopping.example.com/product/..."
              placeholderTextColor="#94A3B8"
              style={[styles.input, error ? styles.inputError : undefined]}
              value={productUrl}
            />
            <View style={styles.materialCard}>
              <Text style={styles.noticeTitle}>{inputSource === 'browser_extension' ? '확장 프로그램에서 가져온 자료' : '상품 설명·이미지 추가 (선택)'}</Text>
              <Text style={styles.noticeBody}>페이지를 읽지 못해도 설명이나 이미지를 제공하면 분석할 수 있어요. 첨부한 자료가 있으면 판매 페이지를 다시 요청하지 않습니다.</Text>
              {pageTitle ? <Text style={styles.officialMeta}>{pageTitle}</Text> : null}
              <TextInput accessibilityLabel="상품 설명" multiline maxLength={12000}
                onChangeText={value => { setProvidedText(value); setConsent(false); }}
                placeholder="상품명, 가격, 판매자, 옵션, 구성품 등 필요한 설명을 붙여넣어 주세요."
                placeholderTextColor="#94A3B8" value={providedText} style={[styles.input, styles.textArea]} />
              <Text style={styles.officialMeta}>{providedText.length.toLocaleString()} / 12,000자</Text>
              <Pressable accessibilityRole="button" onPress={chooseImage} style={styles.outlineButton}>
                <Text style={styles.sampleButtonText}>상품 이미지 첨부 ({images.length}/3)</Text>
              </Pressable>
              <Text style={styles.officialMeta}>JPG·PNG·WebP · 한 장 4MB, 합계 8MB. 가격·모델명이 잘 보이는 캡처를 첨부해 주세요. 외형만으로 정품 여부를 판정하지 않아요.</Text>
              {images.map((image, index) => <View key={`${index}-${image.name}`} style={styles.imageRow}>
                <Image accessibilityLabel={`첨부 이미지 ${index + 1}`} source={{ uri: image.uri }} style={styles.imagePreview} resizeMode="contain" />
                <View style={styles.imageInfo}><Text numberOfLines={2} style={styles.noticeBody}>{image.name}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={`이미지 ${index + 1} 삭제`}
                    onPress={() => { setImages(current => current.filter((_, i) => i !== index)); setConsent(false); }} style={styles.removeImage}>
                    <Text style={styles.errorText}>삭제</Text>
                  </Pressable></View>
              </View>)}
              {(providedText.trim() || images.length > 0) ? <Pressable accessibilityRole="checkbox"
                accessibilityLabel="상품 자료 AI 분석 동의" accessibilityState={{ checked: consent }}
                onPress={() => setConsent(current => !current)} style={styles.consentRow}>
                <Text style={styles.consentMark}>{consent ? '☑' : '☐'}</Text>
                <Text style={styles.consentText}>제공할 자료의 이용 권한을 확인했으며, 설명·이미지를 OpenAI에 보내 분석하는 데 동의합니다. 개인정보는 제외해 주세요.</Text>
              </Pressable> : null}
            </View>
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
              onPress={() => { setProductUrl(sampleLink); setProvidedText(''); setImages([]); setInputSource('user_text'); setCapturedAt(undefined); setPageTitle(''); setConsent(false); }}
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
        </ScrollView>
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
            판매 정보와 공식 페이지를 읽고 비교 근거를 확인하고 있습니다.
          </Text>
        </View>
        <View style={styles.stepsCard}>
          <AnalysisStep label="링크 형식 확인" active />
          <AnalysisStep label="판매 페이지 정보 추출" active />
          <AnalysisStep label="누락 정보 확인" />
          <AnalysisStep label="공식 정보 비교" />
          <AnalysisStep label="상품 설명·배송·반품 조건 분석" />
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
  initialComparison,
  initialRiskAnalysis,
  saleText,
  productUrl,
  warnings,
  source,
  onAddMaterial,
  onBack,
}: {
  initialProduct: ProductDetails;
  officialLookup: OfficialLookup | null;
  initialComparison: ProductComparison | null;
  initialRiskAnalysis: RiskAnalysis | null;
  saleText: string;
  productUrl: string;
  warnings: string[];
  source: SourceSummary | null;
  onAddMaterial: () => void;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState(initialProduct);
  const [result, setResult] = useState(initialComparison);
  const [riskResult, setRiskResult] = useState(initialRiskAnalysis);
  const [lookup, setLookup] = useState(officialLookup);
  const [dirty, setDirty] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);

  const applyCorrections = async () => {
    if (comparing) return;
    setCompareError('');
    setResult(null);
    setRiskResult(null);
    setLookup(null);
    setComparing(true);
    const controller = new AbortController();
    requestRef.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, requestTimeoutMs);
    const cleaned = Object.fromEntries(Object.entries(draft).map(([key, value]) => [
      key, typeof value === 'string' ? value.trim() || '확인 불가' : value,
    ])) as ProductDetails;
    try {
      const response = await fetch(`${apiBaseUrl}/comparisons`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_url: productUrl, product: cleaned, sale_text: saleText, page_title: source?.page_title ?? '' }), signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok || !payload.comparison) {
        throw new Error(typeof payload.detail === 'string' ? payload.detail : '공식 정보 비교에 실패했습니다.');
      }
      setDraft(cleaned);
      setResult(payload.comparison);
      setRiskResult(payload.risk_analysis ?? null);
      setLookup(payload.official_lookup);
      setDirty(false);
    } catch (error) {
      if (timedOut) setCompareError(timeoutMessage);
      else if (!controller.signal.aborted) {
        setCompareError(error instanceof Error ? error.message : '비교 서버에 연결할 수 없습니다.');
      }
    } finally {
      clearTimeout(timer);
      if (!controller.signal.aborted || timedOut) setComparing(false);
    }
  };

  const updateField = (key: keyof ProductDetails, value: string) => {
    setDirty(true);
    setResult(null);
    setRiskResult(null);
    setLookup(null);
    setCompareError('');
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
          <Text style={styles.correctionTitle}>상품 분석 결과</Text>
          <Text style={styles.correctionDescription}>
            자동 추출 결과를 확인하고, 비어 있거나 다른 항목은 직접 수정해 주세요.
          </Text>
          {source ? <View style={styles.noticeCard}>
            <Text style={styles.noticeTitle}>{source.kind && source.kind !== 'server_page' ? '사용자 제공 자료 기반 분석' : '판매 페이지 직접 수집'}</Text>
            <Text selectable style={styles.noticeBody}>{source.final_url}</Text>
            <Text style={styles.officialMeta}>텍스트 {source.text_length.toLocaleString()}자 · 이미지 {source.image_count ?? 0}장</Text>
            {source.captured_at ? <Text style={styles.officialMeta}>사용자 기기의 수집 시각: {new Date(source.captured_at).toLocaleString('ko-KR')}</Text> : null}
            {source.kind && source.kind !== 'server_page' ? <Text style={styles.noticeBody}>제공 자료와 실제 판매 페이지의 일치 여부는 인증하지 않았습니다.</Text> : null}
          </View> : null}
          <Pressable accessibilityRole="button" onPress={onAddMaterial} style={styles.outlineButton}>
            <Text style={styles.sampleButtonText}>상품 설명·이미지로 다시 분석</Text>
          </Pressable>

          {warnings.length > 0 ? (
            <View style={styles.warningCard}>
              <Text style={styles.warningTitle}>직접 확인이 필요해요</Text>
              {warnings.map((warning) => (
                <Text key={warning} style={styles.warningText}>• {warning}</Text>
              ))}
            </View>
          ) : null}

          {!dirty && !comparing ? <RiskChecklist analysis={riskResult} sourceUrl={source?.final_url ?? productUrl} /> : null}
          <Text style={styles.sectionHeading}>공식 정보 비교 결과</Text>
          {result && !dirty ? <ComparisonPanel comparison={result} /> : null}
          {comparing ? (
            <View style={styles.comparingRow} accessibilityRole="progressbar">
              <ActivityIndicator color="#1D6FE8" />
              <Text style={styles.description}>공식 정보와 상품 설명의 확인 항목을 다시 분석하고 있어요.</Text>
            </View>
          ) : null}
          {lookup && !dirty ? <OfficialLookupCard lookup={lookup} /> : null}

          <View style={styles.formCard}>
            {fieldLabels.map(({ key, label }) => (
              <EditableField
                key={key}
                label={label}
                onChangeText={(value) => updateField(key, value)}
                value={draft[key]}
                editable={!comparing}
              />
            ))}
            <EditableField
              label="구성품 (쉼표로 구분)"
              onChangeText={(value) => updateField('components', value)}
              value={draft.components.join(', ')}
              editable={!comparing}
            />
          </View>

          {dirty ? <Text style={styles.officialMessage}>수정한 정보로 공식 정보를 다시 비교해 주세요.</Text> : null}
          {compareError ? <Text accessibilityRole="alert" style={styles.errorText}>{compareError}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={comparing}
            onPress={applyCorrections}
            style={({ pressed }) => [styles.primaryButton, (pressed || comparing) && styles.pressed]}
          >
            <Text style={styles.primaryButtonText}>{comparing ? '공식 정보 비교 중' : '수정 정보로 다시 비교'}</Text>
          </Pressable>
          <Pressable onPress={onBack} style={styles.cancelButton}>
            <Text style={styles.cancelButtonText}>다른 링크 분석하기</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ComparisonPanel({ comparison }: { comparison: ProductComparison }) {
  const selected = comparison.pages.find((page) => page.url === comparison.selected_url);
  const facts = selected?.facts;
  const price = comparison.price;
  const formatAmount = (amount: string | null) => amount === null ? '확인 불가' :
    `${Number(amount).toLocaleString('ko-KR', { maximumFractionDigits: 2 })} ${price.currency ?? ''}`;
  const evidenceLabels: Record<string, string> = {
    product_name: '공식 상품명', model_number: '공식 모델명', price: '공식 가격',
    currency: '통화', seller_guidance: '공식 구매처 안내',
  };
  return (
    <View style={styles.comparisonSection}>
      <View style={[
        styles.statusBand,
        comparison.status === 'exact' ? styles.statusExact :
          comparison.status === 'similar' ? styles.statusSimilar : styles.statusUnknown,
      ]}>
        <Text style={styles.statusLabel}>{comparison.label}</Text>
        <Text style={styles.officialMessage}>{comparison.message}</Text>
      </View>
      {facts ? (
        <View style={styles.factRows}>
          <InfoRow label="공식 상품명" value={facts.product_name} />
          <InfoRow label="공식 모델명" value={facts.model_number} />
          <InfoRow label="공식 가격" value={`${facts.price} ${facts.currency === '확인 불가' ? '' : facts.currency}`} />
        </View>
      ) : null}
      <Text style={styles.sectionHeading}>가격 비교</Text>
      {price.status === 'available' ? (
        <View style={styles.factRows}>
          <InfoRow label="현재 판매가" value={formatAmount(price.sale_price)} />
          <InfoRow label="공식 가격" value={formatAmount(price.official_price)} />
          <InfoRow label="판매가 - 공식가" value={`${formatAmount(price.difference)} (${price.difference_percent}%)`} />
        </View>
      ) : null}
      <Text style={styles.officialMessage}>{price.message}</Text>
      <Text style={styles.sectionHeading}>공식 판매처 확인</Text>
      <Text style={styles.officialMessage}>{comparison.seller_message}</Text>
      <Text style={styles.sectionHeading}>공식 페이지 근거</Text>
      {comparison.pages.length === 0 ? <Text style={styles.officialMessage}>읽을 수 있는 공식 페이지 근거가 없습니다.</Text> : null}
      {comparison.pages.map((page) => (
        <View key={page.url} style={styles.sourceSection}>
          <Pressable accessibilityRole="link" onPress={() => Linking.openURL(page.url)}>
            <Text style={styles.searchResultTitle}>{page.title}</Text>
            <Text style={styles.searchResultUrl}>{page.url}</Text>
          </Pressable>
          {page.facts.evidence.length === 0 ? <Text style={styles.officialMeta}>확인 가능한 상품 정보 근거가 부족합니다.</Text> : null}
          {page.facts.evidence.map((item, index) => (
            <View key={`${item.field}-${index}`} style={styles.quoteRow}>
              <Text style={styles.officialMeta}>{evidenceLabels[item.field] ?? item.field}</Text>
              <Text selectable style={styles.quoteText}>{item.quote}</Text>
            </View>
          ))}
        </View>
      ))}
      {comparison.warnings.map((warning) => <Text key={warning} style={styles.warningText}>{warning}</Text>)}
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.infoRow}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>;
}

function OfficialLookupCard({ lookup }: { lookup: OfficialLookup }) {
  return (
    <View style={styles.officialCard}>
      <Text style={styles.officialTitle}>공식 사이트 검색 결과</Text>
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
  editable = true,
}: {
  label: string;
  onChangeText: (value: string) => void;
  value: string;
  editable?: boolean;
}) {
  const needsInput = value === '확인 불가';
  return (
    <View style={styles.fieldGroup}>
      <View style={styles.fieldLabelRow}>
        <Text style={styles.label}>{label}</Text>
        {needsInput ? <Text style={styles.needsInput}>입력 필요</Text> : null}
      </View>
      <TextInput
        accessibilityLabel={label}
        editable={editable}
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
  inputContent: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 32, maxWidth: 860, width: '100%', alignSelf: 'center' },
  materialCard: { marginTop: 20, borderWidth: 1, borderColor: '#E2E8F0', padding: 16, borderRadius: 12, backgroundColor: '#F8FAFC' },
  textArea: { minHeight: 130, textAlignVertical: 'top', paddingVertical: 12, marginTop: 14, lineHeight: 22, backgroundColor: '#FFFFFF' },
  outlineButton: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 14, padding: 8 },
  imageRow: { flexDirection: 'row', gap: 12, marginTop: 14, alignItems: 'center' },
  imagePreview: { width: 88, height: 100, borderRadius: 8, backgroundColor: '#E2E8F0' },
  imageInfo: { flex: 1, minWidth: 0 },
  removeImage: { alignSelf: 'flex-start', padding: 8 },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 16, paddingVertical: 8 },
  consentMark: { fontSize: 24, color: '#1D6FE8' },
  consentText: { flex: 1, color: '#475569', fontSize: 13, lineHeight: 21 },
  correctionContent: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40, maxWidth: 860, width: '100%', alignSelf: 'center' },
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
  comparisonSection: { marginTop: 24 },
  statusBand: { padding: 16, borderRadius: 8 },
  statusExact: { backgroundColor: '#EAF7F0' },
  statusSimilar: { backgroundColor: '#FFFBEB' },
  statusUnknown: { backgroundColor: '#F1F5F9' },
  statusLabel: { fontSize: 20, fontWeight: '800', color: '#172033', lineHeight: 28 },
  sectionHeading: { marginTop: 24, fontSize: 16, fontWeight: '700', color: '#172033' },
  factRows: { marginTop: 12 },
  infoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  infoLabel: { width: 120, color: '#64748B', fontSize: 14, lineHeight: 21 },
  infoValue: { flex: 1, minWidth: 140, color: '#172033', fontSize: 14, fontWeight: '600', lineHeight: 21 },
  sourceSection: { paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  quoteRow: { marginTop: 10, borderLeftWidth: 2, borderLeftColor: '#CBD5E1', paddingLeft: 12 },
  quoteText: { color: '#475569', fontSize: 13, lineHeight: 21, marginTop: 4 },
  comparingRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginVertical: 16 },
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
