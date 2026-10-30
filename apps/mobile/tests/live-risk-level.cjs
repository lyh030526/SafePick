/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../../..');
const output = process.env.LIVE_RISK_OUTPUT || path.join(root, 'docs/validation/2026-10-28/risk-levels');

// Actual app + actual API/model, using previously captured real public page text.
// No page/API route substitution. This is not a fresh Naver collection check.
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const captured = JSON.parse(fs.readFileSync(process.env.LIVE_RISK_CAPTURE_FILE || path.join(root,
    'docs/validation/2026-10-28/week5-real-products/collection.json'), 'utf8'));
  const item = captured.cases.find(item => item.id === (process.env.LIVE_RISK_CASE || 'blueberries'));
  const payload = { version: 1, product_url: item.collected_url || item.url, page_title: item.collected_title || item.page_title,
    provided_text: item.collected_text, captured_at: item.collected_at || item.submitted.captured_at, input_source: 'browser_extension' };
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 950 } });
    page.setDefaultTimeout(120000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${process.env.UI_APP_ORIGIN || 'http://localhost:8082'}/#safepick-import=${encodeURIComponent(JSON.stringify(payload))}`);
    await page.getByRole('checkbox', { name: '상품 자료 AI 분석 동의' }).click();
    const responsePromise = page.waitForResponse(response => response.url().endsWith(':8000/analyses')
      && response.request().method() === 'POST');
    await page.getByText('분석 시작', { exact: true }).click();
    const response = await responsePromise;
    assert.equal(response.status(), 200);
    const body = await response.json();
    assert.equal(body.risk_analysis.status, 'completed');
    assert.equal(body.risk_analysis.assessment.level, 'undetermined');
    assert.ok((body.product.product_name + body.product.brand_name).includes(process.env.LIVE_RISK_KEYWORD || '블루베리'));
    assert.ok(body.risk_analysis.assessment.missing_checks.includes('공식 상품 동일 여부'));
    assert.ok(!body.risk_analysis.checklist.some(item => item.kind === 'attention'));
    await page.getByLabel('구매 전 주의 수준 판단 보류', { exact: true }).waitFor();
    await page.getByText('구매 전 주의 수준', { exact: true }).scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, `live-${item.id}-390.png`) });
    fs.writeFileSync(path.join(output, 'live-ui-api.json'), JSON.stringify({
      checked_at: new Date().toISOString(), actual_api_and_model: true, api_mocked: false,
      fresh_naver_collection: false, original_capture: payload.captured_at, response: body,
    }, null, 2));
    console.log(`PASS actual app/API/model: imported previously captured ${item.id}, grade undetermined, no attention items, no CORS/page errors, no mobile overflow`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
