// Accounts are switched off (lib/session ACCOUNTS_ENABLED): against a fake Supabase, no sign-in is offered, the account
// screens send the shopper home, and nothing reaches the account backend. Run with the web-fake-auth server (port 8082); nothing real is contacted.
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

    // Accounts are switched off: no sign-in anywhere, and the account screens send the shopper home.
    await page.goto(`${app}/`);
    await page.getByText('분석 시작', { exact: true }).waitFor();
    assert.equal(await page.getByText('로그인', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('tab').count(), 0, 'no tab bar when only Home is left');
    for (const route of ['/sign-in', '/my', '/history', '/saved']) {
      await page.goto(`${app}${route}`);
      await page.getByText('분석 시작', { exact: true }).waitFor();
      assert.equal(await page.getByText('카카오로 시작하기').count(), 0, `${route} shows no sign-in`);
    }
    // An analysis does not offer saving, and nothing reaches the account backend.
    await page.getByLabel('상품 링크', { exact: true }).fill(listingUrl);
    await page.getByText('분석 시작', { exact: true }).click();
    await page.getByText('상품 분석 결과', { exact: true }).waitFor();
    assert.equal(await page.getByText(/관심 판매처/).count(), 0);
    await page.screenshot({ path: path.join(output, 'accounts-off.png'), fullPage: true });
    assert.deepEqual(calls.filter(call => !call.startsWith('OPTIONS')), []);
    assert.deepEqual(errors, []);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false);
    console.log(`PASS accounts off: no sign-in, account screens go home, no saving. Screenshots: ${output}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
