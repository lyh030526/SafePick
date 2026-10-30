const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const product = {
  brand_name: 'Apple', product_name: 'AirPods Pro 3', model_number: 'A3063', price: '299000',
  currency: 'KRW', seller_name: '테스트 판매처', components: ['충전 케이스'],
};
const labels = { exact: '동일 상품 확인', similar: '유사 상품 확인', not_found: '확인되지 않음', unknown: '확인 불가' };
function comparison(status) {
  return {
    status, label: labels[status], message: '공식 페이지 근거를 바탕으로 비교한 결과입니다.',
    selected_url: 'https://www.apple.com/kr/airpods-pro/',
    pages: [{ url: 'https://www.apple.com/kr/airpods-pro/', title: 'AirPods Pro 3 - Apple (KR)', facts: {
      product_name: 'AirPods Pro 3', model_number: 'A3063', price: '369000', currency: 'KRW',
      seller_guidance: '공식 온라인 스토어에서 구매하세요.', match: status,
      evidence: [{ field: 'price', quote: 'AirPods Pro 3 A3063 369,000원' },
        { field: 'seller_guidance', quote: '공식 온라인 스토어에서 구매하세요.' }],
    } }],
    price: status === 'exact' ? {
      status: 'available', sale_price: '299000', official_price: '369000', currency: 'KRW',
      difference: '-70000', difference_percent: '-18.97', message: '차이 = 판매가 - 공식 가격.',
    } : { status: 'unavailable', message: '동일 상품과 가격을 확인할 수 없습니다.' },
    seller_status: 'unknown', seller_message: '판매자명만으로 공식 판매처 여부를 판단할 수 없습니다.', warnings: [],
  };
}
const officialLookup = {
  status: 'found', brand: { name: 'Apple', domains: ['apple.com'] }, query: 'Apple AirPods Pro 3',
  results: [{ title: 'Apple AirPods Pro 3', url: 'https://www.apple.com/kr/airpods-pro/', snippet: '공식 상품 정보' }],
  message: '공식 검색 결과입니다.',
};

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const output = process.env.UI_SCREENSHOT_DIR || path.join(process.env.TEMP || '.', 'safepick-week4-ui');
  fs.mkdirSync(output, { recursive: true });
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      let nextStatus = 'exact';
      let failRequest = false;
      let correctedPayload;
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('http://localhost:8000/**', async route => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*',
            'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,GET,OPTIONS' } });
          return;
        }
        if (route.request().url().endsWith('/comparisons')) {
          correctedPayload = route.request().postDataJSON();
          await route.fulfill({ status: failRequest ? 502 : 200,
            headers: { 'access-control-allow-origin': '*' }, json: failRequest ? { detail: '테스트 연결 오류' } : {
              official_lookup: officialLookup, comparison: comparison(nextStatus),
            } });
        } else {
          await route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: {
            status: 'completed', product, warnings: [], official_lookup: officialLookup,
            source: { page_title: '테스트 상품', final_url: 'https://shop.example.com/p', text_length: 100 },
            comparison: comparison('exact'),
          } });
        }
      });
      page.setDefaultTimeout(60000);
      await page.goto('http://localhost:8081', { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.getByLabel('상품 링크', { exact: true }).fill('https://shop.example.com/p');
      await page.getByText('분석 시작', { exact: true }).click();
      await page.getByText('동일 상품 확인', { exact: true }).waitFor();
      assert.match(await page.locator('body').innerText(), /-70,000 KRW/);
      await page.evaluate(() => {
        window.open = url => { window.__openedOfficialUrl = String(url); return null; };
      });
      await page.getByRole('link').first().click();
      assert.equal(await page.evaluate(() => window.__openedOfficialUrl), 'https://www.apple.com/kr/airpods-pro/');
      await page.screenshot({ path: path.join(output, `exact-${viewport.width}.png`), fullPage: true });
      for (const status of ['similar', 'not_found', 'unknown']) {
        nextStatus = status;
        await page.getByLabel('모델명', { exact: true }).fill(`수정모델-${status}`);
        assert.equal(await page.getByText('동일 상품 확인', { exact: true }).count(), 0);
        await page.getByText('수정 정보로 다시 비교', { exact: true }).click();
        await page.getByText(labels[status], { exact: true }).first().waitFor();
        assert.equal(correctedPayload.product.model_number, `수정모델-${status}`);
      }
      failRequest = true;
      await page.getByText('수정 정보로 다시 비교', { exact: true }).click();
      await page.getByText('테스트 연결 오류', { exact: true }).waitFor();
      failRequest = false;
      nextStatus = 'exact';
      await page.getByText('수정 정보로 다시 비교', { exact: true }).click();
      await page.getByText('동일 상품 확인', { exact: true }).waitFor();
      const overflow = await page.evaluate(() => ({
        width: innerWidth, scroll: document.documentElement.scrollWidth,
        outside: [...document.querySelectorAll('input,button,a')].filter(element => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
        }).length,
      }));
      assert.ok(overflow.scroll <= overflow.width + 1, JSON.stringify(overflow));
      assert.equal(overflow.outside, 0, JSON.stringify(overflow));
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`PASS ${viewport.width}px: four states, price, sources, correction, retry, layout`);
    }
    if (process.env.LIVE_UI === '1') {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      page.setDefaultTimeout(60000);
      await page.goto('http://localhost:8081', { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.getByLabel('상품 링크', { exact: true }).fill('https://www.apple.com/kr/airpods-pro/');
      await page.getByText('분석 시작', { exact: true }).click();
      await page.getByText('공식 정보 비교 결과', { exact: true }).waitFor({ timeout: 150000 });
      await page.getByText('동일 상품 확인', { exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, 'live-apple-390.png'), fullPage: true });
      console.log('PASS live Apple: sale extraction, official search, grounded comparison, mobile UI');
      await page.close();
    }
    console.log(`Screenshots: ${output}`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
