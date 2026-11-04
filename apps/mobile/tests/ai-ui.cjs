// The three AI helpers on the web app, against a mocked API: the seller-conversation check, the bait-option price note,
// and questions answered from the result's own findings. Run with the web server (port 8081); nothing real is called.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const app = process.env.UI_APP_ORIGIN || 'http://localhost:8081';
const listingUrl = 'https://www.coupang.com/vp/products/9711633440';
const assessment = { level: 'moderate', label: '보통', summary: '대표 가격은 싸 보이지만 상품 자체의 옵션은 훨씬 비쌉니다.',
  reasons: ['대표 가격과 실제 옵션 가격 차이 (옵션 최저가 389,000원)'], missing_checks: [], criteria: [], score: 52,
  score_label: '주의 필요', coverage_percent: 80, checked_count: 4, rule_version: '14' };
const none = { status: 'unknown', text: '확인 불가', quotes: [] };
const analysis = {
  status: 'completed', warnings: [], sale_text: '',
  product: { brand_name: '소니', product_name: '노이즈캔슬링 헤드폰', model_number: 'WH-1000XM5', price: '9900', currency: 'KRW',
    seller_name: '테스트스토어', components: ['헤드폰'], condition: 'new',
    options: [{ name: '전용 케이스', price: '9900', kind: 'addon' }, { name: '헤드폰 블랙', price: '389000', kind: 'main' }] },
  source: { page_title: '소니 헤드폰 | 쿠팡', final_url: listingUrl, text_length: 300, kind: 'server_page', image_count: 0 },
  official_lookup: { status: 'not_supported', message: '미지원', results: [], brand: null, query: null },
  comparison: { status: 'unknown', label: '확인 불가', message: '미지원', selected_url: null, pages: [],
    price: { status: 'unavailable', message: '-' }, seller_status: 'unknown', seller_message: '-', warnings: [] },
  risk_analysis: { status: 'completed', message: '확인 1건', warnings: [], checklist: [], assessment,
    claim_check: { status: 'unverified', label: '확인되지 않은 정품·공식 표시', brand_owner: '소니',
      message: '이미지의 인증 마크가 있지만 판매자가 브랜드 회사가 아니어서 SafePick이 확인할 수 없습니다. 마크와 문구는 쉽게 복사할 수 있어 점수에 넣지 않았습니다.',
      claims: [{ kind: 'genuine', quote: '100% 정품 보장' }], marks: [{ name: '소니 공식 인증 마크', source: 'image' }] },
    conditions: { description: { status: 'found', text: '헤드폰', quotes: [] }, components: none, options: none, shipping: none,
      returns: { status: 'found', text: '수령 후 7일 이내 반품', quotes: [] }, warranty: none } },
  seller_verification: { status: 'active', label: '계속사업자', message: '정상', tax_type: null, closed_on: null,
    seller: { business_name: '테스트스토어', representative: '-', business_number: '123-45-67891', mail_order_number: '-', address: '-', quote: '-' } },
  market_price: { status: 'no_model', label: '시세 판단 보류', message: '시세를 찾지 않았습니다.', match_count: 0, listings: [],
    option_bait: true, option_price: '389000', list_inflated: true,
    list_note: '할인 전 가격으로 표시한 599000원은 같은 모델 시세 중앙값(400000원)의 149%입니다.',
    option_note: '대표 가격 9900원은 상품 옵션 최저가 389000원의 2%입니다. 싼 대표 가격은 부속품·사은품 옵션의 가격일 수 있으니, 실제로 고르는 옵션의 결제 금액을 확인해 주세요.' },
};
const conversation = { level: 'high', label: '높음', read_length: 80,
  summary: "'개인 계좌·현금 결제 유도' 신호를 확인했습니다. 흔한 사기 수법이니 입금이나 결제를 멈추세요.",
  signals: [{ kind: 'off_platform_payment', label: '개인 계좌·현금 결제 유도', severity: 'high',
    quote: '상대: 국민은행 123456-****-****** 로 입금해주시면 바로 발송해요', advice: '마켓의 정상 결제 말고는 입금하지 마세요.' }],
  links: [{ url: 'coupang-safepay.shop/pay', domain: 'coupang-safepay.shop', status: 'impersonates', label: '쿠팡 사칭 의심 주소',
    message: '쿠팡의 이름을 썼지만 공식 도메인이 아닙니다. 결제하지 마세요.' }],
  warnings: ['대화는 저장하지 않습니다. 결과의 계좌·전화번호는 일부를 가렸습니다.'] };

(async () => {
  const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'msedge', headless: true });
  const output = path.join(process.env.TEMP || '.', 'safepick-ai-ui');
  fs.mkdirSync(output, { recursive: true });
  const calls = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    page.setDefaultTimeout(60000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    await page.route('http://localhost:8000/**', async route => {
      const request = route.request();
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const url = new URL(request.url());
      calls.push({ path: url.pathname, body: request.postDataJSON() });
      if (url.pathname === '/conversation-checks') return route.fulfill({ headers: cors, json: conversation });
      if (url.pathname === '/analysis-questions') return route.fulfill({ headers: cors, json: { status: 'answered',
        answer: '판매자는 국세청에 정상 사업자로 조회돼요. 다만 대표 가격과 옵션 가격 차이가 있어요.',
        citations: [{ id: 'E5', text: '판매자 사업자 확인: 계속사업자. 정상' }] } });
      return route.fulfill({ headers: cors, json: analysis });
    });

    // The conversation check: channel, pasted chat, consent, and the result with its quote and link.
    await page.goto(app);
    await page.getByText('판매자와 나눈 대화 확인', { exact: true }).click();
    await page.getByText('어디서 나눈 대화인가요?', { exact: true }).waitFor();
    await page.getByText('카카오톡·문자 등 마켓 밖', { exact: true }).click();
    await page.getByLabel('대화 내용', { exact: true }).fill('상대: 국민은행 123456-12-345678 로 입금해주시면 바로 발송해요');
    await page.getByText('대화 확인하기', { exact: true }).click();
    await page.getByText('대화 자료의 AI 분석 동의를 확인해 주세요.', { exact: true }).waitFor();
    assert.equal(calls.length, 0);
    await page.getByRole('checkbox', { name: '대화 자료 AI 분석 동의' }).click();
    await page.getByText('대화 확인하기', { exact: true }).click();
    await page.getByLabel('대화 주의 수준 높음', { exact: true }).waitFor();
    await page.getByText('쿠팡 사칭 의심 주소', { exact: true }).waitFor();
    assert.equal(calls[0].path, '/conversation-checks');
    assert.equal(calls[0].body.channel, 'messenger');
    assert.match(calls[0].body.text, /국민은행/);
    await page.screenshot({ path: path.join(output, 'chat-check.png'), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    console.log('PASS conversation check: channel, consent gate, quote, link verdict');

    // The bait option and questions on a result.
    await page.goto(app);
    await page.getByLabel('상품 링크', { exact: true }).fill(listingUrl);
    await page.getByText('분석 시작', { exact: true }).click();
    await page.getByText('대표 가격과 옵션 가격 차이', { exact: true }).waitFor();
    await page.getByText('가격 시세 비교', { exact: true }).click();
    await page.getByText(/옵션 최저가 389000원의 2%/).waitFor();
    await page.getByText(/시세 중앙값\(400000원\)의 149%/).waitFor();
    await page.getByText('정품·공식 판매 표시', { exact: true }).click();
    await page.getByText(/점수에 넣지 않았습니다/).waitFor();
    await page.getByText('소니 공식 인증 마크 (이미지)', { exact: true }).waitFor();
    await page.getByText('이 판매자 믿어도 될까?', { exact: true }).click();
    await page.getByText(/정상 사업자로 조회돼요/).waitFor();
    const asked = calls.find(call => call.path === '/analysis-questions');
    assert.equal(asked.body.question, '이 판매자 믿어도 될까?');
    assert.equal(asked.body.risk_analysis.assessment.level, 'moderate');
    assert.equal(asked.body.product.options.length, 2);
    await page.getByText('근거 1개 보기', { exact: true }).click();
    await page.getByText('판매자 사업자 확인: 계속사업자. 정상', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'result-ask.png'), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);
    console.log(`PASS result: bait option note, evidence-only question, citations. Screenshots: ${output}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
