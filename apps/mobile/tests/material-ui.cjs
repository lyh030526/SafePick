/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../../..');
const extensionPath = path.join(root, 'apps/extension');
const imagePath = path.join(root, 'docs/validation/2026-10-28/material-input/synthetic-product.png');
const output = process.env.UI_SCREENSHOT_DIR || path.join(process.env.TEMP || '.', 'safepick-material-ui');
const appOrigin = process.env.UI_APP_ORIGIN || 'http://localhost:8081';
const productUrl = process.env.TEST_PRODUCT_URL || 'https://smartstore.naver.com/demo/products/12345?option=blue';
const product = { brand_name: 'DemoBrand', product_name: '테스트 무선 헤드폰', model_number: 'SP-TEST-100',
  price: '129000', currency: 'KRW', seller_name: '데모스토어', components: ['헤드폰', 'USB-C 케이블'] };
const fixture = `<html lang="ko"><head><title>테스트 무선 헤드폰</title></head><body>
  <header>PRIVATE-ACCOUNT-HEADER</header><main><h1>DemoBrand 테스트 무선 헤드폰</h1>
  <p>모델명 SP-TEST-100 / 판매 가격 129,000원 KRW / 판매자 데모스토어 / 구성품 헤드폰 USB-C 케이블</p>
  <input value="PRIVATE-INPUT"><form>PRIVATE-FORM</form><p style="display:none">PRIVATE-HIDDEN</p>
  <script type="application/ld+json">{"@type":"Product","name":"테스트 무선 헤드폰","sku":"SP-TEST-100","offers":{"price":"129000","priceCurrency":"KRW","seller":{"name":"데모스토어"}}}</script>
  </main><footer>PRIVATE-FOOTER</footer></body></html>`;

async function mockApi(page, calls) {
  await page.route('http://localhost:8000/**', async route => {
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,GET,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const body = route.request().postDataJSON();
    calls.push(body);
    await route.fulfill({ headers, json: { status: 'completed', product,
      source: { page_title: body.page_title || '상품 자료', final_url: body.product_url,
        text_length: (body.provided_text || '').length, image_count: body.images?.length || 0,
        kind: body.provided_text && body.images?.length ? 'mixed' : body.images?.length ? 'user_images' : body.input_source || 'server_page',
        captured_at: body.captured_at },
      warnings: ['사용자가 제공한 자료입니다.'], official_lookup: { status: 'not_supported', message: '미지원 브랜드', results: [], brand: null, query: null }, comparison: null,
    } });
  });
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const context = await chromium.launchPersistentContext('', { channel: process.env.TEST_BROWSER_CHANNEL || 'chromium', headless: true,
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  try {
    const browserCdp = await context.browser().newBrowserCDPSession();
    const { id } = await browserCdp.send('Extensions.loadUnpacked', { path: extensionPath });
    console.log('Loaded test extension');
    const shop = await context.newPage();
    await shop.route(`${new URL(productUrl).origin}/**`, route => route.fulfill({ contentType: 'text/html', body: fixture }));
    await shop.goto(productUrl);
    await shop.bringToFront();
    const { targetInfos } = await browserCdp.send('Target.getTargets', { filter: [{ type: 'tab' }, { exclude: true }] });
    const targetInfo = targetInfos.find(target => target.url === productUrl);
    assert.ok(targetInfo, JSON.stringify(targetInfos));
    await browserCdp.send('Extensions.triggerAction', { id, targetId: targetInfo.targetId });
    console.log('Granted activeTab through extension action');
    const allTargets = await browserCdp.send('Target.getTargets', { filter: [{}] });
    for (const target of allTargets.targetInfos.filter(item => item.type === 'other' && item.url.startsWith(`chrome-extension://${id}/`))) {
      await browserCdp.send('Target.closeTarget', { targetId: target.targetId });
    }
    // Native action popups are CDP "other" targets. Open the same installed popup
    // document as a test tab after the real action grants activeTab to the shop.
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    console.log('Opened installed popup document');
    await shop.bringToFront();
    await popup.evaluate(() => document.getElementById('collect').click());
    console.log('Requested page collection');
    await popup.locator('#preview').waitFor({ state: 'visible' });
    const text = await popup.locator('#text').inputValue();
    assert.match(text, /SP-TEST-100/);
    assert.match(text, /129000/);
    assert.doesNotMatch(text, /PRIVATE/);
    assert.equal(await popup.locator('#url').inputValue(), productUrl);
    assert.ok(await popup.locator('#send').isDisabled());
    await popup.locator('#app-origin').selectOption(appOrigin);
    await popup.screenshot({ path: path.join(output, 'extension-preview.png') });
    await popup.locator('#consent').check();
    const appPromise = context.waitForEvent('page');
    await popup.locator('#send').click();
    const app = await appPromise;
    app.setDefaultTimeout(60000);
    const calls = [];
    await mockApi(app, calls);
    await app.getByText('확장 프로그램에서 가져온 자료', { exact: true }).waitFor();
    assert.equal(new URL(app.url()).origin, appOrigin);
    assert.equal(new URL(app.url()).hash, '');
    assert.equal(await app.getByLabel('상품 링크', { exact: true }).inputValue(), productUrl);
    await app.getByText('분석 시작', { exact: true }).click();
    await app.getByText('상품 자료의 AI 분석 동의를 확인해 주세요.', { exact: true }).waitFor();
    assert.equal(calls.length, 0);
    await app.getByRole('checkbox', { name: '상품 자료 AI 분석 동의' }).click();
    await app.getByText('분석 시작', { exact: true }).click();
    await app.getByText('사용자 제공 자료 기반 분석', { exact: true }).waitFor();
    assert.equal(calls[0].input_source, 'browser_extension');
    assert.equal(calls[0].product_url, productUrl);
    assert.equal(calls[0].provided_text, text);
    console.log('PASS installed extension: real action/activeTab, DOM+JSON-LD, preview, consent, app handoff, source metadata');
    await app.close();

    for (const width of [390, 1440]) {
      const page = await context.newPage();
      await page.setViewportSize({ width, height: 900 });
      page.setDefaultTimeout(60000);
      const requests = [];
      await mockApi(page, requests);
      await page.goto(appOrigin);
      await page.getByLabel('상품 링크', { exact: true }).fill(productUrl);
      await page.getByLabel('상품 설명', { exact: true }).fill('모델 SP-TEST-100 판매가 129000원');
      const chooserPromise = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: '상품 이미지 첨부 (0/3)', exact: true }).click();
      await (await chooserPromise).setFiles(imagePath);
      await page.getByLabel('첨부 이미지 1', { exact: true }).waitFor();
      await page.getByRole('checkbox', { name: '상품 자료 AI 분석 동의' }).click();
      await page.screenshot({ path: path.join(output, `materials-${width}.png`), fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.getByText('분석 시작', { exact: true }).click();
      await page.getByText('사용자 제공 자료 기반 분석', { exact: true }).waitFor();
      assert.equal(requests[0].images.length, 1);
      assert.equal(requests[0].images[0].mime_type, 'image/png');
      assert.ok(requests[0].images[0].base64_data.length > 100);
      await page.getByRole('button', { name: '상품 설명·이미지로 다시 분석' }).click();
      await page.getByRole('button', { name: '이미지 1 삭제' }).click();
      assert.equal(await page.getByLabel('첨부 이미지 1', { exact: true }).count(), 0);
      await page.getByText('분석 시작', { exact: true }).click();
      await page.getByText('상품 자료의 AI 분석 동의를 확인해 주세요.', { exact: true }).waitFor();
      assert.equal(requests.length, 1);
      await page.getByLabel('상품 설명', { exact: true }).fill('');
      await page.getByText('분석 시작', { exact: true }).click();
      await page.getByText('공식 정보 비교 결과', { exact: true }).waitFor();
      assert.equal(requests.length, 2);
      assert.equal(requests[1].images, undefined);
      await page.getByText('다른 링크 분석하기', { exact: true }).click();
      assert.equal(await page.getByLabel('상품 링크', { exact: true }).inputValue(), '');
      assert.equal(await page.getByLabel('상품 설명', { exact: true }).inputValue(), '');
      assert.equal(await page.getByLabel('첨부 이미지 1', { exact: true }).count(), 0);
      console.log(`PASS ${width}px: image picker, preview, multimodal payload, consent, deletion, link-only regression, layout`);
      await page.close();
    }
    const invalid = await context.newPage();
    await invalid.goto(appOrigin + '/#safepick-import=%invalid');
    await invalid.getByText(/확장 프로그램의 상품 정보를 읽지 못했습니다/).waitFor();
    assert.equal(new URL(invalid.url()).hash, '');
    assert.deepEqual(errors, []);
    console.log(`PASS invalid import, URL cleanup, no browser errors. Screenshots: ${output}`);
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
