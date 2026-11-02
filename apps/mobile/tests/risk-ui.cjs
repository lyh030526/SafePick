const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const appOrigin = process.env.UI_APP_ORIGIN || 'http://localhost:8081';
const url = 'https://shopping.naver.com/window-products/demo/12345';
const text = 'DemoBrand SP-100 헤드폰. 오늘만 90% 할인! 지금 구매하세요. 배송비 3,000원.';
const promo = '오늘만 90% 할인! 지금 구매하세요.';
const product = { brand_name: 'DemoBrand', product_name: '헤드폰', model_number: 'SP-100', price: '129000', currency: 'KRW', seller_name: '테스트 판매자', components: ['확인 불가'] };
const official = { status: 'not_supported', message: '공식 비교 미지원 브랜드', results: [], brand: null, query: null };
const comparison = { status: 'unknown', label: '확인 불가', message: '공식 비교 미지원 브랜드', selected_url: null, pages: [],
  price: { status: 'unavailable', message: '가격 비교 불가' }, seller_status: 'unknown', seller_message: '판매자 인증 결과가 아닙니다.', warnings: [] };
function risk(status = 'completed', empty = false, level = empty ? 'undetermined' : 'moderate') {
  if (status !== 'completed') level = 'undetermined';
  const scores = { high: { score: 20, score_label: '구매 보류 권장', coverage_percent: 100, checked_count: 1 },
    moderate: { score: 45, score_label: '주의 필요', coverage_percent: 100, checked_count: 1 },
    low: { score: 100, score_label: '근거 양호', coverage_percent: 100, checked_count: 1 },
    undetermined: { score: null, score_label: '점수 보류', coverage_percent: 0, checked_count: 0 } };
  const levelLabel = { high: '높음', moderate: '보통', low: '낮음', undetermined: '판단 보류' }[level];
  const conditions = Object.fromEntries(['description', 'components', 'options', 'shipping', 'returns', 'warranty'].map(key => [key, { status: 'unknown', text: '확인 불가', quotes: [] }]));
  conditions.shipping = { status: 'found', text: '배송비 3,000원.', quotes: ['배송비 3,000원.'] };
  return { status, message: status === 'completed' ? empty ? '수집한 자료에서 추가 확인할 표현을 찾지 못했습니다. 안전성을 보장하는 결과는 아닙니다.' : '표현·불일치 확인 2건 · 정보 확인 1건'
    : status === 'unavailable' ? 'AI 서비스 오류로 위험 신호 분석을 완료하지 못했습니다.' : '위험 신호의 원문 근거를 확인할 상품 설명이 부족합니다.',
    conditions, checklist: status === 'completed' && !empty ? [
      { id: 'purchase_pressure', category: 'purchase_pressure', kind: 'attention', title: '구매를 서두르게 하는 표현', explanation: '서두르게 하는 문구를 확인해 주세요.', quotes: [promo], how_to_check: '상품 사양과 배송·반품 조건을 먼저 확인해 주세요.' },
      { id: 'discount_claim', category: 'discount_claim', kind: 'attention', title: '할인·최저가 기준 확인', explanation: '기준 가격을 확인해 주세요.', quotes: [promo], how_to_check: '쿠폰·배송비를 포함한 결제 금액을 확인해 주세요.' },
      { id: 'missing_returns', category: 'missing_information', kind: 'needs_check', title: '반품·교환 조건 확인 필요', explanation: '수집 자료에서 반품 조건을 확인하지 못했습니다.', quotes: [], how_to_check: '페이지의 반품·교환 안내를 펼쳐 확인해 주세요.' },
    ] : [], warnings: ['사기·가품 여부나 판매자의 신뢰도를 인증하지 않습니다.'],
    assessment: { level, label: levelLabel, summary: '수집한 근거로 정한 구매 전 주의 수준입니다.',
      reasons: ['테스트 판단 근거'], missing_checks: level === 'low' ? [] : ['공식 상품 동일 여부 또는 판매자 사업자 확인'],
      criteria: [{ key: 'official', label: '공식 정보 비교', status: level === 'low' ? 'confirmed' : 'unknown', detail: '공식 정보 확인 상태입니다.' }],
      ...scores[level], rule_version: '12' } };
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const output = path.join(process.env.TEMP || '.', 'safepick-week5-ui');
  fs.mkdirSync(output, { recursive: true });
  try {
    for (const width of [390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 950 } });
      page.setDefaultTimeout(60000);
      const errors = [];
      const corrections = [];
      let status = 'completed';
      let empty = false;
      let level;
      page.on('pageerror', error => errors.push(error.message));
      await page.route('http://localhost:8000/**', async route => {
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,GET,OPTIONS' };
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (route.request().url().endsWith('/comparisons')) {
          corrections.push(route.request().postDataJSON());
          return route.fulfill({ headers, json: { official_lookup: official, comparison, risk_analysis: risk(status, empty, level) } });
        }
        return route.fulfill({ headers, json: { status: 'completed', product, official_lookup: official, comparison,
          source: { page_title: '테스트 헤드폰', final_url: url, text_length: text.length, kind: 'browser_extension', image_count: 0 },
          warnings: [], sale_text: text, risk_analysis: risk() } });
      });
      const imported = { version: 1, product_url: url, page_title: '테스트 헤드폰', provided_text: text,
        input_source: 'browser_extension', captured_at: '2026-10-28T03:00:00Z' };
      await page.goto(`${appOrigin}/#safepick-import=${encodeURIComponent(JSON.stringify(imported))}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('checkbox', { name: '상품 자료 AI 분석 동의' }).click();
      await page.getByText('분석 시작', { exact: true }).click();
      await page.getByText('상품 분석 결과', { exact: true }).waitFor();
      await page.getByText('구매 전 체크리스트', { exact: true }).waitFor();
      await page.getByLabel('구매 전 주의 수준 보통', { exact: true }).waitFor();
      await page.getByText(promo, { exact: true }).first().waitFor();
      await page.getByText('수집 자료에서 확인 불가', { exact: true }).waitFor();
      await page.getByRole('checkbox', { name: '구매를 서두르게 하는 표현 확인 완료' }).click();
      await page.getByText('직접 확인한 항목 1 / 3', { exact: true }).waitFor();
      await page.getByLabel('구매 전 주의 수준 보통', { exact: true }).waitFor();
      await page.getByText('상품 조건 원문 보기', { exact: true }).click();
      await page.getByText('배송비 3,000원.', { exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, `checklist-${width}.png`), fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      status = 'unavailable';
      await page.getByLabel('모델명', { exact: true }).fill('SP-200');
      assert.equal(await page.getByText('구매 전 체크리스트', { exact: true }).count(), 0);
      await page.getByText('수정 정보로 다시 비교', { exact: true }).click();
      await page.getByText('AI 서비스 오류로 위험 신호 분석을 완료하지 못했습니다.', { exact: true }).waitFor();
      await page.getByLabel('구매 전 주의 수준 판단 보류', { exact: true }).waitFor();
      assert.equal(await page.getByText(promo, { exact: true }).count(), 0);
      assert.equal(corrections[0].sale_text, text);
      assert.equal(corrections[0].product.model_number, 'SP-200');
      status = 'completed'; empty = true;
      await page.getByText('수정 정보로 다시 비교', { exact: true }).click();
      await page.getByText('수집한 자료에서 추가 확인할 표현을 찾지 못했습니다. 안전성을 보장하는 결과는 아닙니다.', { exact: true }).waitFor();
      assert.equal(await page.getByRole('checkbox').count(), 0);
      await page.getByLabel('구매 전 주의 수준 판단 보류', { exact: true }).waitFor();
      await page.getByLabel('신뢰 점수 보류', { exact: true }).waitFor();
      for (const [value, label] of [['high', '높음'], ['low', '낮음'], ['moderate', '보통']]) {
        level = value;
        await page.getByText('수정 정보로 다시 비교', { exact: true }).click();
        await page.getByLabel(`구매 전 주의 수준 ${label}`, { exact: true }).waitFor();
        const score = { high: '신뢰 점수 20점 구매 보류 권장', low: '신뢰 점수 100점 근거 양호', moderate: '신뢰 점수 45점 주의 필요' }[value];
        await page.getByLabel(score, { exact: true }).waitFor();
        await page.getByText('구매 전 주의 수준', { exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, `level-${value}-${width}.png`) });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      }
      status = 'insufficient';
      await page.getByText('수정 정보로 다시 비교', { exact: true }).click();
      await page.getByText('위험 신호의 원문 근거를 확인할 상품 설명이 부족합니다.', { exact: true }).waitFor();
      await page.getByLabel('구매 전 주의 수준 판단 보류', { exact: true }).waitFor();
      assert.equal(await page.getByText(promo, { exact: true }).count(), 0);
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: extension import, grounded checklist, missing info, checkboxes, conditions, correction source, unavailable/insufficient/empty, no overflow`);
      await page.close();
    }
    console.log(`Screenshots: ${output}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
