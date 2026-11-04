// Sign-in and My Page against a fake Supabase: Kakao sign-in, an analysis saved to history, a saved listing, the
// nickname, sign-out, and account deletion. Run with the web-fake-auth server (port 8082); nothing real is contacted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const app = process.env.UI_AUTH_ORIGIN || 'http://localhost:8082';
const supabase = 'https://fake-project.supabase.co';
const listingUrl = 'https://www.coupang.com/vp/products/9711633440';
const user = { id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated', email: '',
  app_metadata: { provider: 'kakao', providers: ['kakao'] }, user_metadata: { name: '테스터' }, created_at: '2026-11-03T00:00:00Z' };
const session = () => ({ access_token: 'access-token', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'refresh-token', user });
const assessment = { level: 'moderate', label: '보통', summary: '리뷰가 실제 구매 후기가 아닐 수 있는 흔적을 발견했습니다.',
  reasons: ['AI로 작성한 흔적이 있는 리뷰'], missing_checks: [], criteria: [], score: 49, score_label: '주의 필요',
  coverage_percent: 100, checked_count: 3, rule_version: '13' };
const conditions = Object.fromEntries(['description', 'components', 'options', 'shipping', 'returns', 'warranty']
  .map(key => [key, { status: 'unknown', text: '확인 불가', quotes: [] }]));
const analysis = { status: 'completed', warnings: [], sale_text: '판매 페이지 원문',
  product: { brand_name: 'TECNONEXO', product_name: '무선 블루투스 이어폰', model_number: 'LX-96', price: '12900', currency: 'KRW',
    seller_name: '리샤무역 유한회사', components: ['확인 불가'] },
  source: { page_title: 'TECNONEXO 이어폰 | 쿠팡', final_url: listingUrl, text_length: 100, kind: 'user_text', image_count: 0 },
  official_lookup: { status: 'not_supported', message: '미지원', results: [], brand: null, query: null },
  comparison: { status: 'unknown', label: '확인 불가', message: '미지원', selected_url: null, pages: [],
    price: { status: 'unavailable', message: '-' }, seller_status: 'unknown', seller_message: '-', warnings: [] },
  risk_analysis: { status: 'completed', message: '확인 1건', conditions, checklist: [], warnings: [], assessment },
  seller_verification: { status: 'active', label: '계속사업자', message: '정상', tax_type: null, closed_on: null,
    seller: { business_name: '리샤무역 유한회사', representative: '-', business_number: '423-88-03703', mail_order_number: '-', address: '-', quote: '-' } },
  market_price: { status: 'insufficient', label: '시세 판단 보류', message: '-', match_count: 0, listings: [] } };

(async () => {
  const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'msedge', headless: true });
  const output = path.join(process.env.TEMP || '.', 'safepick-account-ui');
  fs.mkdirSync(output, { recursive: true });
  const db = { analyses: [], saved_listings: [], profiles: [{ id: user.id, nickname: '테스터' }] };
  const calls = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    page.setDefaultTimeout(60000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    await page.route(`${supabase}/**`, async route => {
      const request = route.request();
      const url = new URL(request.url());
      calls.push(`${request.method()} ${url.pathname}`);
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (url.pathname === '/auth/v1/authorize') {
        // Kakao's consent is skipped: the provider "returns" straight to the app with a code.
        assert.equal(url.searchParams.get('provider'), 'kakao');
        assert.equal(url.searchParams.get('scopes'), 'profile_nickname profile_image');
        const back = new URL(url.searchParams.get('redirect_to'));
        back.searchParams.set('code', 'fake-code');
        return route.fulfill({ status: 302, headers: { location: back.toString() } });
      }
      if (url.pathname === '/auth/v1/token') return route.fulfill({ headers: cors, json: session() });
      if (url.pathname === '/auth/v1/user') return route.fulfill({ headers: cors, json: user });
      if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
      const table = url.pathname.replace('/rest/v1/', '');
      if (!db[table]) return route.fulfill({ status: 404, headers: cors, json: {} });
      if (request.method() === 'GET') {
        const rows = db[table];
        const single = (request.headers().accept || '').includes('vnd.pgrst.object');
        return route.fulfill({ headers: cors, json: single ? rows[0] ?? null : rows });
      }
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        const row = { id: `${table}-${db[table].length + 1}`, created_at: '2026-11-03T01:00:00Z', ...body };
        db[table] = [row, ...db[table].filter(item => !(table === 'saved_listings' && item.product_url === row.product_url))];
        if (table === 'profiles') db.profiles = [body];
        return route.fulfill({ status: 201, headers: cors, json: [row] });
      }
      if (request.method() === 'DELETE') {
        const id = (url.searchParams.get('id') || '').replace('eq.', '');
        db[table] = db[table].filter(item => item.id !== id);
        return route.fulfill({ status: 204, headers: cors });
      }
      return route.fulfill({ status: 405, headers: cors });
    });
    let deletedWith = null;
    await page.route('http://localhost:8000/**', async route => {
      const request = route.request();
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (request.url().endsWith('/account')) {
        deletedWith = request.headers().authorization;
        db.analyses = []; db.saved_listings = [];
        return route.fulfill({ headers: cors, json: { status: 'deleted' } });
      }
      return route.fulfill({ headers: cors, json: analysis });
    });

    // Signed out: analysis is open, My Page is not.
    await page.goto(`${app}/`);
    await page.getByText('로그인', { exact: true }).click();
    await page.getByText('카카오로 시작하기').waitFor();
    await page.screenshot({ path: path.join(output, 'sign-in.png'), fullPage: true });
    await page.goto(`${app}/my`);
    await page.getByText('로그인하고 내 기록을 모아 보세요', { exact: true }).waitFor();
    assert.equal(await page.getByText('회원 탈퇴', { exact: true }).count(), 0);
    await page.getByText('로그인하기', { exact: true }).click();
    await page.getByText('카카오로 시작하기').waitFor();

    // Kakao sign-in comes back signed in, and the header offers My Page.
    await page.getByText('카카오로 시작하기').click();
    await page.getByLabel('마이페이지', { exact: true }).waitFor();
    assert.ok(calls.includes('POST /auth/v1/token'), 'the returned code is exchanged for a session');

    // An analysis while signed in lands in history, without the collected page text.
    await page.getByLabel('상품 링크', { exact: true }).fill(listingUrl);
    await page.getByText('분석 시작', { exact: true }).click();
    await page.getByText('관심 판매처로 저장').waitFor();
    await page.waitForFunction(() => true);
    for (let i = 0; i < 20 && !db.analyses.length; i++) await page.waitForTimeout(250);
    assert.equal(db.analyses.length, 1);
    assert.equal(db.analyses[0].level, 'moderate');
    assert.equal(db.analyses[0].seller_name, '리샤무역 유한회사');
    assert.equal('sale_text' in db.analyses[0].result, false);
    await page.getByText('관심 판매처로 저장').click();
    await page.getByText('관심 판매처에 저장했어요').waitFor();
    assert.equal(db.saved_listings.length, 1);

    // My Page: history, saved listings, nickname.
    // A reload of /my keeps the shopper on My Page while the stored session is read back.
    await page.goto(`${app}/my`);
    await page.getByText('테스터', { exact: true }).waitFor();
    await page.getByText('카카오 계정으로 로그인했어요').waitFor();
    await page.screenshot({ path: path.join(output, 'my-page.png'), fullPage: true });
    await page.getByText('분석 기록', { exact: true }).click();
    await page.getByText('무선 블루투스 이어폰').waitFor();
    await page.getByText('결과 보기').click();
    await page.getByText('• AI로 작성한 흔적이 있는 리뷰').waitFor();
    await page.screenshot({ path: path.join(output, 'history.png'), fullPage: true });
    await page.getByText('기록 삭제').click();
    await page.getByText('아직 분석한 판매 페이지가 없어요', { exact: false }).waitFor();
    await page.goto(`${app}/saved`);
    await page.getByText('리샤무역 유한회사 · 12,900원').waitFor();
    await page.screenshot({ path: path.join(output, 'saved.png'), fullPage: true });
    await page.goto(`${app}/my`);
    // The stored nickname fills the field once it is read back; the new one replaces it after that.
    await page.waitForFunction(() => document.querySelector('input[aria-label="닉네임"]')?.value === '테스터');
    await page.getByLabel('닉네임').fill('세이프픽');
    await page.getByText('닉네임 저장').click();
    await page.getByText('닉네임을 저장했어요.').waitFor();
    assert.equal(db.profiles[0].nickname, '세이프픽');

    // Deleting the account asks once more, sends the session token to the API, and signs out.
    await page.getByText('회원 탈퇴', { exact: true }).last().click();
    await page.getByText('모든 기록을 지우고 탈퇴하기').click();
    await page.getByText('로그인', { exact: true }).waitFor();
    assert.equal(deletedWith, 'Bearer access-token');
    assert.equal(db.saved_listings.length, 0);
    assert.deepEqual(errors, []);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false);
    console.log(`PASS account: Kakao sign-in, history auto-save, saved listing, nickname, deletion. Screenshots: ${output}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
