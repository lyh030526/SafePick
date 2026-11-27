import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { useFocusEffect, useRouter } from 'expo-router';
import { findLink, isMarketLink, parseBrowserImport, secureMarketLink } from './browserImport';
import { listAnalyses, saveAnalysis, saveListing, summarize, type HistoryItem } from './lib/account';
import { takePendingCapture, takePendingLink } from './lib/pendingCapture';
import { pickImage, type AttachedImage } from './lib/pickImage';
import { useSession } from './lib/session';
import { GroupComparisonScreen } from './GroupComparison';
import { AskAnalysis } from './AskAnalysis';
import { RecentRow } from './ListingRow';
import { MarketPriceCard, type MarketPrice } from './MarketPrice';
import { ClaimCard, PhotoCard, Verdict, type RiskAnalysis } from './RiskChecklist';
import { SellerCheck, type SellerVerification } from './SellerCheck';
import { colors, installWebFont, radius, shadow, type } from './theme';
import { Button, Card, CheckCircle, Disclosure, DisclosureGroup, Divider, Icon, ListRow, Logo, Pill, SectionTitle, TopBar, text } from './ui';

installWebFont();

type AnalysisState = 'input' | 'loading' | 'correction';

type ProductDetails = {
  brand_name: string;
  product_name: string;
  model_number: string;
  price: string;
  currency: string;
  seller_name: string;
  components: string[];
  options?: { name: string; price: string; kind: 'main' | 'addon' }[];
  condition?: 'new' | 'refurbished' | 'used' | 'display' | 'parallel_import' | 'unknown';
};

type AnalysisResponse = {
  status: 'completed' | 'manual_input_required';
  product: ProductDetails;
  source: SourceSummary;
  warnings: string[];
  official_lookup: OfficialLookup;
  comparison: ProductComparison | null;
  risk_analysis?: RiskAnalysis;
  seller_verification?: SellerVerification;
  market_price?: MarketPrice;
  sale_text?: string;
};

type SourceSummary = {
  page_title: string; final_url: string; text_length: number;
  kind?: 'server_page' | 'user_text' | 'browser_extension' | 'user_images' | 'mixed';
  image_count?: number; captured_at?: string | null;
};

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
  discovered?: boolean;
  maker?: MakerCheck | null;
};

type MakerCheck = {
  status: 'seller_is_maker' | 'listed' | 'see_detail' | 'missing';
  label: string;
  message: string;
  maker: string;
  importer: string;
  origin: string;
  kc_numbers: string[];
  kc_link: string | null;
};

const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';
// The server bounds each step; this only stops the screen from waiting forever.
const requestTimeoutMs = 150_000;
const timeoutMessage = '분석 시간이 너무 오래 걸려 중단했어요. 잠시 후 다시 시도하거나 상품 설명을 직접 붙여넣어 주세요.';

const fieldLabels: { key: keyof Omit<ProductDetails, 'components' | 'options' | 'condition'>; label: string }[] = [
  { key: 'brand_name', label: '브랜드명' },
  { key: 'product_name', label: '상품명' },
  { key: 'model_number', label: '모델명' },
  { key: 'price', label: '판매 가격' },
  { key: 'currency', label: '통화' },
  { key: 'seller_name', label: '판매처' },
];

function initialBrowserImport() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return { payload: null, error: '' };
  const hash = window.location.hash;
  // The material is read once and taken out of the address before anything is drawn.
  if (hash.startsWith('#safepick-import=')) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  try { return { payload: parseBrowserImport(hash), error: '' }; }
  catch (error) { return { payload: null, error: error instanceof Error ? error.message : '상품 정보를 불러오지 못했습니다.' }; }
}

export default function App() {
  // The extension opens #safepick-group to compare several pages of the same product.
  const [group] = useState(() => Platform.OS === 'web' && typeof window !== 'undefined' && window.location.hash === '#safepick-group');
  return group ? <GroupComparisonScreen apiBaseUrl={apiBaseUrl} /> : <SingleAnalysis />;
}

function SingleAnalysis() {
  const { session } = useSession();
  const [initialImport] = useState(initialBrowserImport);
  const [productUrl, setProductUrl] = useState(initialImport.payload?.product_url ?? '');
  const [error, setError] = useState(initialImport.error);
  const [analysisState, setAnalysisState] = useState<AnalysisState>('input');
  const [product, setProduct] = useState<ProductDetails | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [officialLookup, setOfficialLookup] = useState<OfficialLookup | null>(null);
  const [comparison, setComparison] = useState<ProductComparison | null>(null);
  const [riskAnalysis, setRiskAnalysis] = useState<RiskAnalysis | null>(null);
  const [sellerVerification, setSellerVerification] = useState<SellerVerification | null>(null);
  const [marketPrice, setMarketPrice] = useState<MarketPrice | null>(null);
  const [analysisText, setAnalysisText] = useState('');
  const [providedText, setProvidedText] = useState(initialImport.payload?.provided_text ?? '');
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [inputSource, setInputSource] = useState<'user_text' | 'browser_extension'>(initialImport.payload?.input_source ?? 'user_text');
  const [pageTitle, setPageTitle] = useState(initialImport.payload?.page_title ?? '');
  const [capturedAt, setCapturedAt] = useState<string | undefined>(initialImport.payload?.captured_at);
  const [imageUrl, setImageUrl] = useState<string | undefined>(initialImport.payload?.image_url);
  const [consent, setConsent] = useState(false);
  const [source, setSource] = useState<SourceSummary | null>(null);
  // The description and images stay folded away until needed; imported material opens them for review.
  // Imported page text stays folded; the shopper opens it only to look or to edit.
  const [materialOpen, setMaterialOpen] = useState(false);
  const [recent, setRecent] = useState<HistoryItem[]>([]);
  const requestRef = useRef<AbortController | null>(null);
  const router = useRouter();
  useEffect(() => () => requestRef.current?.abort(), []);
  // Signed-in shoppers see their last few analyses on the home screen.
  useFocusEffect(useCallback(() => {
    if (!session) { setRecent([]); return; }
    listAnalyses().then(items => setRecent(items.slice(0, 3))).catch(() => undefined);
  }, [session]));
  // A page read in the in-app Coupang browser arrives like an extension import: shown for review, sent only on consent.
  useFocusEffect(useCallback(() => {
    const link = takePendingLink();
    if (link) {
      setProductUrl(link); setProvidedText(''); setImages([]); setInputSource('user_text'); setCapturedAt(undefined);
      setPageTitle(''); setConsent(false); setError(''); setAnalysisState('input');
    }
    const capture = takePendingCapture();
    if (!capture) return;
    setProductUrl(capture.product_url); setProvidedText(capture.provided_text); setPageTitle(capture.page_title);
    setInputSource('browser_extension'); setCapturedAt(capture.captured_at); setImageUrl(capture.image_url); setImages([]); setConsent(false);
    setError(''); setAnalysisState('input'); setMaterialOpen(false);
  }, []));
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    // The address was cleared when the import was read; this keeps it clear while the router settles.
    if (!initialImport.payload && !initialImport.error) return;
    // Expo Router writes the address it started with back once it settles, and again when the stored sign-in has been
    // read, so the imported material is cleared repeatedly for the first seconds rather than only on the first render.
    const clear = () => {
      if (window.location.hash.startsWith('#safepick-import=')) {
        window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
      }
    };
    clear();
    const timer = setInterval(clear, 100);
    const stop = setTimeout(() => clearInterval(timer), 3000);
    return () => { clearInterval(timer); clearTimeout(stop); };
  }, []);

  const chooseImage = async () => {
    try {
      const image = await pickImage(images, 3);
      if (!image) return;
      setImages(current => [...current, { ...image, name: image.name.replace(/^이미지/, '상품 이미지') }].slice(0, 3));
      setConsent(false); setError('');
    } catch (error) { setError(error instanceof Error ? error.message : '이미지를 첨부하지 못했습니다.'); }
  };

  // The clipboard is read only when the shopper taps the button, never in the background.
  const pasteLink = async () => {
    const link = findLink(await Clipboard.getStringAsync().catch(() => ''));
    if (!link) { setError('복사한 링크가 없어요. 쿠팡·G마켓·옥션 앱의 공유 → 링크 복사로 복사해 주세요.'); return; }
    setProductUrl(link); setProvidedText(''); setImages([]); setInputSource('user_text'); setCapturedAt(undefined);
    setPageTitle(''); setConsent(false); setError('');
    if (isMarketLink(link)) router.push({ pathname: '/browse', params: { url: secureMarketLink(link) } });
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
    // Coupang turns away the analysis server, so on the phone a Coupang, G마켓 or 옥션 link opens in the in-app browser
    // and is read there.
    if (Platform.OS !== 'web' && !hasProvidedData && isMarketLink(parsedUrl.toString())) {
      setError('');
      router.push({ pathname: '/browse', params: { url: secureMarketLink(parsedUrl.toString()) } });
      return;
    }
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
            input_source: inputSource, captured_at: capturedAt, image_url: inputSource === 'browser_extension' ? imageUrl : undefined,
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
      setSellerVerification(payload.seller_verification ?? null);
      setMarketPrice(payload.market_price ?? null);
      setAnalysisText(payload.sale_text ?? providedText.trim());
      setSource(payload.source);
      setAnalysisState('correction');
      // Signed-in shoppers find every analysis again under My Page; a failed save never blocks the result.
      if (session) saveAnalysis(parsedUrl.toString(), payload).catch(() => undefined);
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
        initialSeller={sellerVerification}
        initialMarket={marketPrice}
        saleText={analysisText}
        productUrl={productUrl.trim()}
        warnings={warnings}
        source={source}
        onAddMaterial={() => { setConsent(false); setMaterialOpen(true); setAnalysisState('input'); }}
        onBack={() => {
          setProductUrl(''); setProvidedText(''); setImages([]); setPageTitle('');
          setInputSource('user_text'); setCapturedAt(undefined); setConsent(false);
          setError(''); setSource(null); setRiskAnalysis(null); setSellerVerification(null); setMarketPrice(null); setAnalysisText(''); setAnalysisState('input');
        }}
      />
    );
  }

  const hasMaterial = !!providedText.trim() || images.length > 0;
  const imported = inputSource === 'browser_extension';
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboardContainer}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <BrandHeader />
          <View style={styles.hero}>
            <Text style={text.display}>사기 전에,{'\n'}판매처부터 확인하세요</Text>
            <Text style={text.body}>판매자 사업자 상태, 가격, 상품 설명의 위험 신호를 한 번에 살펴봐요.</Text>
          </View>

          <Card style={styles.linkCard}>
            <View style={[styles.linkField, error ? styles.linkFieldError : undefined]}>
              <Icon name="link-outline" size={20} color={colors.textMuted} />
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
                placeholder="판매 페이지 링크를 붙여넣어 주세요"
                placeholderTextColor={colors.textFaint}
                style={styles.linkInput}
                value={productUrl}
              />
              {Platform.OS !== 'web' ? <Pressable accessibilityRole="button" accessibilityLabel="복사한 링크 붙여넣기" onPress={pasteLink}
                style={({ pressed }) => [styles.pasteButton, pressed && styles.pressed]}>
                <Text style={styles.pasteText}>붙여넣기</Text>
              </Pressable> : null}
            </View>
            {error ? <Text accessibilityRole="alert" style={text.error}>{error}</Text> : null}
            {/* The consent sits right above the button it unlocks, so imported material is one tap from analysis. */}
            {hasMaterial ? <Pressable accessibilityRole="checkbox"
              accessibilityLabel="상품 자료 AI 분석 동의" accessibilityState={{ checked: consent }}
              onPress={() => { setConsent(current => !current); setError(''); }} style={styles.consentRow}>
              <CheckCircle checked={consent} />
              <Text style={styles.consentText}>{imported ? '가져온 페이지 내용' : '넣은 설명·이미지'}을 OpenAI에 보내 분석하는 데 동의합니다. 자료의 이용 권한을 확인했고 개인정보는 넣지 않았어요.</Text>
            </Pressable> : null}
            <Button label="분석 시작" icon="search" onPress={startAnalysis} />
          </Card>

          {Platform.OS !== 'web' ? <Card tight>
            <ListRow icon="share-social-outline" title="쿠팡·G마켓·옥션 앱에서 공유로 보내기" subtitle="상품 화면에서 공유 → SafePick을 누르면 바로 분석해요" />
          </Card> : null}


          <Disclosure title={imported ? '가져온 페이지 내용' : '상품 설명·이미지 추가'} icon="document-attach-outline"
            status={hasMaterial ? (imported ? '가져온 자료가 있어요' : `자료 ${providedText.trim() ? '설명' : ''}${providedText.trim() && images.length ? '·' : ''}${images.length ? `이미지 ${images.length}장` : ''}`) : undefined}
            tone="brand" open={materialOpen} onToggle={setMaterialOpen}>
            <Text style={text.small}>페이지를 읽지 못할 때 설명이나 캡처를 넣으면 그 자료로 분석해요. 첨부한 자료가 있으면 판매 페이지를 다시 요청하지 않아요.</Text>
            {pageTitle ? <Text style={text.strong}>{pageTitle}</Text> : null}
            <TextInput accessibilityLabel="상품 설명" multiline maxLength={12000}
              onChangeText={value => { setProvidedText(value); setConsent(false); }}
              placeholder="상품명, 가격, 판매자, 옵션, 구성품 등을 붙여넣어 주세요."
              placeholderTextColor={colors.textFaint} value={providedText} style={[styles.input, styles.textArea]} />
            <Text style={[text.small, styles.counter]}>{providedText.length.toLocaleString()} / 12,000자</Text>
            <Button tone="secondary" icon="image-outline" label={`상품 이미지 첨부 (${images.length}/3)`} onPress={chooseImage} />
            <Text style={text.small}>JPG·PNG·WebP · 한 장 4MB, 합계 8MB. 가격·모델명이 잘 보이는 캡처가 좋아요. 외형만으로 정품 여부를 판정하지 않아요.</Text>
            {images.map((image, index) => <View key={`${index}-${image.name}`} style={styles.imageRow}>
              <Image accessibilityLabel={`첨부 이미지 ${index + 1}`} source={{ uri: image.uri }} style={styles.imagePreview} resizeMode="contain" />
              <View style={styles.imageInfo}><Text numberOfLines={2} style={text.body}>{image.name}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`이미지 ${index + 1} 삭제`}
                  onPress={() => { setImages(current => current.filter((_, i) => i !== index)); setConsent(false); }} style={styles.removeImage}>
                  <Text style={styles.removeImageText}>삭제</Text>
                </Pressable></View>
            </View>)}
          </Disclosure>

          {recent.length ? <>
            <SectionTitle action={<Pressable accessibilityRole="button" onPress={() => router.push('/history')}>
              <Text style={text.link}>전체 보기</Text></Pressable>}>최근 분석</SectionTitle>
            <Card tight>
              {recent.map((item, index) => <View key={item.id}>
                {index ? <Divider /> : null}
                <RecentRow item={item} onPress={() => router.push('/history')} />
              </View>)}
            </Card>
          </> : null}

          <View style={styles.trust}>
            <Icon name="information-circle-outline" size={16} color={colors.textMuted} />
            <Text style={[text.small, styles.flex]}>SafePick은 사기 여부를 단정하지 않고, 구매 전에 확인할 근거를 보여 드려요. 공식 사이트를 찾은 브랜드는 공식 정보와 비교하고, 찾지 못하면 상품정보 고시의 제조·수입사를 대신 확인해요.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function BrandHeader() {
  const { session, available } = useSession();
  const router = useRouter();
  return (
    <View style={styles.brandRow}>
      <Logo />
      <Text style={styles.appName}>SafePick</Text>
      {available && !session ? <Pressable accessibilityRole="button" onPress={() => router.push('/sign-in')}
        style={({ pressed }) => [styles.accountButton, pressed && styles.pressed]}>
        <Text style={styles.accountButtonText}>로그인</Text>
      </Pressable> : null}
      {session ? <Pressable accessibilityRole="button" accessibilityLabel="마이페이지" onPress={() => router.push('/my')}
        style={({ pressed }) => [styles.avatarButton, pressed && styles.pressed]}>
        <Icon name="person" size={18} color={colors.brandText} />
      </Pressable> : null}
    </View>
  );
}

// Saves the listing under My Page with its current result; signed-out shoppers are sent to sign in first.
function SaveListingButton({ productUrl, product, source, risk, seller }: {
  productUrl: string; product: ProductDetails; source: SourceSummary | null; risk: RiskAnalysis | null;
  seller: SellerVerification | null;
}) {
  const { session, available } = useSession();
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const summary = source && risk ? summarize(productUrl, { product, source, risk_analysis: risk, seller_verification: seller }) : null;
  if (!available || !summary) return null;
  const save = async () => {
    if (!session) { router.push('/sign-in'); return; }
    setState('saving');
    try { await saveListing(summary); setState('saved'); } catch { setState('error'); }
  };
  return <Button icon={state === 'saved' ? 'bookmark' : 'bookmark-outline'} busy={state === 'saving'} disabled={state === 'saved'} onPress={save}
    label={state === 'saved' ? '관심 판매처에 저장했어요' : state === 'error' ? '저장하지 못했어요. 다시 눌러 주세요'
      : session ? '관심 판매처로 저장' : '로그인하고 관심 판매처로 저장'} />;
}

// The one action that stays at the bottom of a result; nothing is shown when saving is not available.
function SaveFooter(props: Parameters<typeof SaveListingButton>[0]) {
  const { available } = useSession();
  if (!available || !props.source || !props.risk) return null;
  return <View style={styles.footer}>
    <View style={styles.footerInner}><SaveListingButton {...props} /></View>
  </View>;
}

const progressSteps = ['판매 페이지 정보 읽기', '판매자 사업자 상태 조회', '가격 시세 비교', '상품 설명의 위험 신호 분석'];

function AnalysisProgress({ onCancel }: { onCancel: () => void }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.progressContent}>
        <View style={styles.progressHero}>
          <View style={styles.progressBadge}><ActivityIndicator color={colors.brand} size="large" /></View>
          <Text style={[text.title, styles.center]}>상품을 분석하고 있어요</Text>
          <Text style={[text.body, styles.center]}>보통 10~20초 걸려요. 서버가 잠시 쉬고 있었다면 30초쯤 더 걸릴 수 있어요.</Text>
        </View>
        <Card style={styles.steps}>
          {progressSteps.map((label, index) => <View key={label} style={styles.stepRow}>
            <View style={[styles.stepDot, index === 0 && styles.stepDotActive]}>
              <Text style={[styles.stepNumber, index === 0 && styles.stepNumberActive]}>{index + 1}</Text>
            </View>
            <Text style={[text.body, index === 0 && styles.stepActive]}>{label}</Text>
          </View>)}
        </Card>
        <View style={styles.progressFooter}>
          <Button tone="ghost" label="링크 입력으로 돌아가기" onPress={onCancel} />
        </View>
      </View>
    </SafeAreaView>
  );
}

function CorrectionForm({
  initialProduct,
  officialLookup,
  initialComparison,
  initialRiskAnalysis,
  initialSeller,
  initialMarket,
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
  initialSeller: SellerVerification | null;
  initialMarket: MarketPrice | null;
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
  const [seller, setSeller] = useState(initialSeller);
  const [market, setMarket] = useState(initialMarket);
  const [lookup, setLookup] = useState(officialLookup);
  const [dirty, setDirty] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const router = useRouter();
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
      setSeller(payload.seller_verification ?? null);
      setMarket(payload.market_price ?? null);
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

  const fresh = !dirty && !comparing;
  const price = /^\d+$/.test(draft.price) ? `${Number(draft.price).toLocaleString('ko-KR')}원` : draft.price;
  const productLine = [draft.product_name, draft.seller_name, price].filter(value => value && value !== '확인 불가').join(' · ');
  const comparisonTone = result?.status === 'exact' ? 'good' : result?.status === 'similar' ? 'warn' : 'neutral';
  const provided = source?.kind && source.kind !== 'server_page';
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboardContainer}>
        {/* The scroll area and the chat button share one box, so the button floats above the save footer. */}
        <View style={styles.flex}>
        <ScrollView contentContainerStyle={[styles.content, styles.resultContent]} keyboardShouldPersistTaps="handled">
          <TopBar title="상품 분석 결과" onBack={onBack} />
          {/* The verdict comes first; each check, the checklist and where the material came from follow it. */}
          {fresh ? <Verdict analysis={riskResult} product={productLine} /> : null}
          {comparing ? (
            <Card style={styles.comparingRow} >
              <ActivityIndicator color={colors.brand} />
              <Text style={[text.body, styles.flex]}>수정한 정보로 다시 분석하고 있어요.</Text>
            </Card>
          ) : null}
          {dirty ? <Card style={styles.dirtyNote}>
            <Icon name="create-outline" size={18} color={colors.orangeText} />
            <Text style={[text.body, styles.flex]}>상품 정보를 수정했어요. 아래 &apos;수정 정보로 다시 비교&apos;를 누르면 결과가 새로 나와요.</Text>
          </Card> : null}

          {warnings.length > 0 ? (
            <View style={styles.warningCard}>
              <Icon name="alert-circle-outline" size={18} color={colors.orangeText} />
              <View style={styles.flex}>
                <Text style={styles.warningTitle}>직접 확인이 필요해요</Text>
                {warnings.map((warning) => <Text key={warning} style={text.body}>{warning}</Text>)}
              </View>
            </View>
          ) : null}

          {fresh ? <>
            <SectionTitle>근거 한눈에 보기</SectionTitle>
            <DisclosureGroup>
              <SellerCheck verification={seller} />
              <MarketPriceCard market={market} />
              <ClaimCard check={riskResult?.claim_check} />
              <PhotoCard check={riskResult?.photo_check} />
              {(result || lookup) ? <Disclosure title="공식 정보 비교" icon="ribbon-outline"
                status={result ? (result.status === 'unknown' && lookup?.maker ? lookup.maker.label : result.label) : undefined}
                tone={result?.status === 'unknown' && lookup?.maker?.status === 'seller_is_maker' ? 'good' : comparisonTone}>
                {result ? <ComparisonPanel comparison={result} /> : null}
                {lookup ? <OfficialLookupCard lookup={lookup} /> : null}
              </Disclosure> : null}
            </DisclosureGroup>
          </> : null}


          {/* What was read and the extracted fields stay out of the way; a shopper opens them only to correct something. */}
          <Disclosure title="분석한 자료 · 정보 수정" icon="document-text-outline" status={dirty ? '수정함' : undefined} tone="warn"
            defaultOpen={dirty}>
            {source ? <View style={styles.sourceBlock}>
              <Text style={text.strong}>{provided ? '사용자 제공 자료 기반 분석' : '판매 페이지 직접 수집'}</Text>
              <Text selectable numberOfLines={2} style={text.small}>{source.final_url}</Text>
              <Text style={text.small}>{[`텍스트 ${source.text_length.toLocaleString()}자`, `이미지 ${source.image_count ?? 0}장`,
                source.captured_at && `수집 ${new Date(source.captured_at).toLocaleString('ko-KR')}`].filter(Boolean).join(' · ')}</Text>
              {provided ? <Text style={text.small}>제공 자료와 실제 판매 페이지의 일치 여부는 인증하지 않았어요.</Text> : null}
              <Button tone="secondary" icon="add-circle-outline" label="상품 설명·이미지로 다시 분석" onPress={onAddMaterial} />
            </View> : null}
            <Text style={text.small}>자동으로 읽은 상품 정보예요. 틀린 항목을 고치고 다시 비교할 수 있어요.</Text>
            {fieldLabels.map(({ key, label }) => (
              <EditableField key={key} label={label} onChangeText={(value) => updateField(key, value)} value={draft[key]} editable={!comparing} />
            ))}
            <EditableField label="구성품 (쉼표로 구분)" onChangeText={(value) => updateField('components', value)}
              value={draft.components.join(', ')} editable={!comparing} />
            {compareError ? <Text accessibilityRole="alert" style={text.error}>{compareError}</Text> : null}
            <Button tone={dirty ? 'primary' : 'secondary'} icon="refresh" busy={comparing}
              label={comparing ? '공식 정보 비교 중' : '수정 정보로 다시 비교'} onPress={applyCorrections} />
          </Disclosure>
          <Button tone="ghost" icon="arrow-back" label="다른 링크 분석하기" onPress={onBack} />
        </ScrollView>
        {fresh && riskResult ? <AskAnalysis title={productLine} analysis={{ product: draft, risk_analysis: riskResult, seller_verification: seller,
            market_price: market, comparison: result }} /> : null}
        </View>
        {fresh ? <SaveFooter productUrl={productUrl} product={draft} source={source} risk={riskResult} seller={seller} /> : null}
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
    <View style={styles.panel}>
      <Text style={text.body}>{comparison.message}</Text>
      {facts ? (
        <View style={styles.factRows}>
          <InfoRow label="공식 상품명" value={facts.product_name} />
          <InfoRow label="공식 모델명" value={facts.model_number} />
          <InfoRow label="공식 가격" value={`${facts.price} ${facts.currency === '확인 불가' ? '' : facts.currency}`} />
        </View>
      ) : null}
      <Text style={text.strong}>가격 비교</Text>
      {price.status === 'available' ? (
        <View style={styles.factRows}>
          <InfoRow label="현재 판매가" value={formatAmount(price.sale_price)} />
          <InfoRow label="공식 가격" value={formatAmount(price.official_price)} />
          <InfoRow label="판매가 - 공식가" value={`${formatAmount(price.difference)} (${price.difference_percent}%)`} />
        </View>
      ) : null}
      <Text style={text.body}>{price.message}</Text>
      <Text style={text.strong}>공식 판매처 확인</Text>
      <Text style={text.body}>{comparison.seller_message}</Text>
      <Text style={text.strong}>공식 페이지 근거</Text>
      {comparison.pages.length === 0 ? <Text style={text.body}>읽을 수 있는 공식 페이지 근거가 없어요.</Text> : null}
      {comparison.pages.map((page) => (
        <View key={page.url} style={styles.sourceSection}>
          <Pressable accessibilityRole="link" onPress={() => Linking.openURL(page.url)}>
            <Text style={styles.linkTitle}>{page.title}</Text>
            <Text numberOfLines={1} style={styles.linkUrl}>{page.url}</Text>
          </Pressable>
          {page.facts.evidence.length === 0 ? <Text style={text.small}>확인 가능한 상품 정보 근거가 부족해요.</Text> : null}
          {page.facts.evidence.map((item, index) => (
            <View key={`${item.field}-${index}`} style={styles.quoteBox}>
              <Text style={styles.quoteLabel}>{evidenceLabels[item.field] ?? item.field}</Text>
              <Text selectable style={styles.quoteText}>{item.quote}</Text>
            </View>
          ))}
        </View>
      ))}
      {comparison.warnings.map((warning) => <Text key={warning} style={styles.warningInline}>{warning}</Text>)}
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.infoRow}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>;
}

function OfficialLookupCard({ lookup }: { lookup: OfficialLookup }) {
  return (
    <View style={styles.panel}>
      <Text style={text.strong}>공식 사이트 검색 결과</Text>
      <Text style={text.body}>{lookup.message}</Text>
      {lookup.brand ? <Text style={text.small}>{lookup.brand.name} 공식 도메인: {lookup.brand.domains.join(', ')}
        {lookup.discovered ? ' (브랜드 이름으로 검색해 찾은 사이트예요. 주소가 맞는지 한 번 더 확인해 주세요.)' : ''}</Text> : null}
      {lookup.query ? <Text style={text.small}>검색어: {lookup.query}</Text> : null}
      {lookup.results.map((result) => (
        <Pressable key={result.url} onPress={() => Linking.openURL(result.url)}
          style={({ pressed }) => [styles.searchResult, pressed && styles.pressed]}>
          <Text numberOfLines={2} style={styles.linkTitle}>{result.title}</Text>
          {result.snippet ? <Text numberOfLines={2} style={styles.searchResultSnippet}>{result.snippet}</Text> : null}
          <Text numberOfLines={1} style={styles.linkUrl}>{result.url}</Text>
        </Pressable>
      ))}
      {lookup.maker ? <MakerPanel maker={lookup.maker} /> : null}
    </View>
  );
}

function MakerPanel({ maker }: { maker: MakerCheck }) {
  const rows = [['제조사', maker.maker], ['수입사', maker.importer], ['제조국', maker.origin],
    ['KC 인증번호', maker.kc_numbers.join(', ')]].filter(([, value]) => value && value !== '확인 불가');
  return (
    <View style={styles.makerPanel}>
      <Text style={text.strong}>제조·수입사 확인 · {maker.label}</Text>
      <Text style={text.body}>{maker.message}</Text>
      {rows.map(([label, value]) => <InfoRow key={label} label={label} value={value} />)}
      {maker.kc_link ? <Pressable accessibilityRole="link" onPress={() => Linking.openURL(maker.kc_link!)}
        style={({ pressed }) => [styles.searchResult, pressed && styles.pressed]}>
        <Text style={styles.linkTitle}>KC 인증번호 조회하러 가기</Text>
        <Text numberOfLines={1} style={styles.linkUrl}>{maker.kc_link}</Text>
      </Pressable> : null}
      <Text style={text.small}>상품정보 고시는 판매자가 적은 내용이라 점수에는 넣지 않았어요.</Text>
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
        placeholderTextColor={colors.textFaint}
        style={[styles.input, needsInput && styles.inputNeedsInput]}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  keyboardContainer: { flex: 1 },
  resultContent: { paddingBottom: 104 },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32, maxWidth: 640, width: '100%', alignSelf: 'center', gap: 12 },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  brandRow: { alignItems: 'center', flexDirection: 'row', gap: 9, height: 48 },
  appName: { color: colors.text, fontSize: 19, fontWeight: '800', letterSpacing: -0.4 },
  accountButton: { marginLeft: 'auto', borderRadius: radius.pill, backgroundColor: colors.brandSoft, paddingHorizontal: 14, paddingVertical: 8 },
  accountButtonText: { color: colors.brandText, fontSize: 14, fontWeight: '700' },
  avatarButton: { marginLeft: 'auto', width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  hero: { paddingTop: 18, paddingBottom: 8, paddingHorizontal: 2, gap: 10 },
  linkCard: { gap: 12 },
  linkField: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.fill, borderRadius: radius.field,
    borderWidth: 1.5, borderColor: colors.fill, paddingLeft: 14, paddingRight: 6, minHeight: 56 },
  linkFieldError: { borderColor: colors.red, backgroundColor: colors.redSoft },
  linkInput: { flex: 1, minWidth: 0, color: colors.text, fontSize: 16, minHeight: 52 },
  pasteButton: { backgroundColor: colors.card, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  pasteText: { color: colors.brandText, fontSize: 14, fontWeight: '700' },
  counter: { textAlign: 'right' },
  label: { color: colors.textSub, fontSize: 14, fontWeight: '600', marginBottom: 8 },
  input: { backgroundColor: colors.fill, borderRadius: radius.field, borderWidth: 1.5, borderColor: colors.fill, color: colors.text, fontSize: 16, minHeight: 52, paddingHorizontal: 14 },
  inputNeedsInput: { borderColor: colors.orange, backgroundColor: colors.orangeSoft },
  textArea: { minHeight: 140, textAlignVertical: 'top', paddingVertical: 14, lineHeight: 23 },
  imageRow: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: colors.fill, borderRadius: radius.field, padding: 10 },
  imagePreview: { width: 72, height: 72, borderRadius: 10, backgroundColor: colors.card },
  imageInfo: { flex: 1, minWidth: 0 },
  removeImage: { alignSelf: 'flex-start', paddingVertical: 6 },
  removeImageText: { color: colors.redText, fontSize: 14, fontWeight: '600' },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, borderRadius: radius.field, backgroundColor: colors.brandSoft },
  consentText: { flex: 1, color: colors.textSub, fontSize: 14, lineHeight: 21 },
  trust: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 4, marginTop: 6 },
  footer: { backgroundColor: colors.card, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12, borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line },
  footerInner: { maxWidth: 600, width: '100%', alignSelf: 'center', gap: 4 },
  pressed: { opacity: 0.7 },
  progressContent: { flex: 1, paddingHorizontal: 20, paddingTop: 16, maxWidth: 640, width: '100%', alignSelf: 'center' },
  progressHero: { alignItems: 'center', marginTop: 64, gap: 10, paddingHorizontal: 12 },
  progressBadge: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  steps: { marginTop: 36, gap: 16, padding: 22 },
  stepRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  stepDot: { backgroundColor: colors.fill, borderRadius: 12, height: 24, width: 24, alignItems: 'center', justifyContent: 'center' },
  stepDotActive: { backgroundColor: colors.brand },
  stepNumber: { color: colors.textMuted, fontSize: 12, fontWeight: '800' },
  stepNumberActive: { color: '#FFFFFF' },
  stepActive: { color: colors.text, fontWeight: '700' },
  progressFooter: { marginTop: 'auto', marginBottom: 12 },
  comparingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dirtyNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: colors.orangeSoft, shadowOpacity: 0, elevation: 0 },
  warningCard: { flexDirection: 'row', gap: 10, backgroundColor: colors.orangeSoft, borderRadius: radius.card, padding: 16 },
  warningTitle: { ...type.body, color: colors.orangeText, fontWeight: '700', marginBottom: 2 },
  warningInline: { color: colors.orangeText, fontSize: 13, lineHeight: 19 },
  sourceBlock: { gap: 8, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  panel: { gap: 10 },
  factRows: { backgroundColor: colors.fill, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 4 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 8 },
  infoLabel: { flexShrink: 0, color: colors.textMuted, fontSize: 14, lineHeight: 21 },
  infoValue: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600', lineHeight: 21, textAlign: 'right' },
  sourceSection: { gap: 8 },
  linkTitle: { color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 22 },
  linkUrl: { color: colors.brandText, fontSize: 13, marginTop: 2 },
  quoteBox: { backgroundColor: colors.fill, borderRadius: 12, padding: 12, gap: 4 },
  quoteLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  quoteText: { color: colors.textSub, fontSize: 14, lineHeight: 21 },
  makerPanel: { gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  searchResult: { backgroundColor: colors.fill, borderRadius: 14, padding: 14, ...shadow, shadowOpacity: 0, elevation: 0 },
  searchResultSnippet: { color: colors.textSub, fontSize: 13, lineHeight: 19, marginTop: 4 },
  fieldGroup: { gap: 0 },
  fieldLabelRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  needsInput: { color: colors.orangeText, fontSize: 13, fontWeight: '700', marginBottom: 8 },
});
