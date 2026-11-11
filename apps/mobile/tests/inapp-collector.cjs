// The in-app Coupang browser injects the extension's collector into the page and receives the capture through
// window.ReactNativeWebView.postMessage. This runs that same injection on a fixture of a phone Coupang product page
// (m.coupang.com/vm/products/...) and checks the generated app copy of the collector is current. No network.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
execFileSync(process.execPath, [path.join(root, 'scripts/sync-collector.cjs'), '--check'], { stdio: 'inherit' });
const { collectorSource } = (() => {
  const text = require('node:fs').readFileSync(path.join(root, 'lib/collectorSource.ts'), 'utf8');
  return { collectorSource: JSON.parse(text.slice(text.indexOf('= ') + 2, text.lastIndexOf(';'))) };
})();
// Same wrapper as CoupangBrowser.native.tsx.
const inject = `(async () => {
  try {
    ${collectorSource}
    const result = await collectProductPage();
    window.ReactNativeWebView.postMessage(JSON.stringify({ result }));
  } catch (error) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ result: { error: String(error) } }));
  }
})(); true;`;
const product = 'https://m.coupang.com/vm/products/9711633440?itemId=1';
const pageWith = moreLabel => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>테스트 이어폰 | 쿠팡</title></head><body>
<main><h1>테스트 이어폰 TE-1</h1><p>12,900원</p><p>판매자: 테스트무역 유한회사</p>
<button onclick="document.getElementById('seller').hidden=false">판매자 정보</button>
<div id="seller" hidden><table><tr><th>상호/대표자</th><td>테스트무역 유한회사 / 홍길동</td></tr>
<tr><th>통신판매업 신고번호</th><td>2026-서울강남-00001</td><th>사업자번호</th><td>123-45-67891</td></tr></table></div>
<p>교환/반품: 수령 후 30일 이내 가능, 반품 배송비 5,000원</p>
<section><h3>필수 표기 정보</h3><table><tr><th>품명 및 모델명</th><td>테스트 이어폰 TE-1</td></tr></table>
<table id="notice" style="display:none"><tr><th>KC 인증정보</th><td>R-R-TST-TE1</td></tr>
<tr><th>제조자(수입자)</th><td>테스트전자 / 테스트무역 유한회사</td></tr><tr><th>제조국</th><td>중국</td></tr></table>
<div class="more" onclick="document.getElementById('notice').style.display='table'; this.remove()"><span>${moreLabel}</span></div>
<p>판매자가 현금거래를 요구하면 거부하시고 즉시 사기 거래 신고센터에 신고하시기 바랍니다.</p></section></main></body></html>`;

(async () => {
  const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    // Coupang labels the notice control either in full or as a bare 더보기 after the table; both are pressed.
    for (const moreLabel of ['필수 표기 정보 더보기', '더보기']) {
    await context.unrouteAll();
    await context.route('https://m.coupang.com/**', route => route.fulfill({ contentType: 'text/html', body: pageWith(moreLabel) }));
    const tab = await context.newPage();
    await tab.goto(product);
    const message = await tab.evaluate(code => new Promise(resolve => {
      window.ReactNativeWebView = { postMessage: resolve };
      // eslint-disable-next-line no-eval
      (0, eval)(code);
    }), inject);
    const { result } = JSON.parse(message);
    assert.equal(result.error, undefined, result.error);
    assert.equal(result.version, 1);
    assert.equal(result.input_source, 'browser_extension');
    assert.equal(result.product_url, product);
    assert.match(result.provided_text, /^판매자 정보:\n[\s\S]*테스트무역 유한회사 \/ 홍길동[\s\S]*사업자번호\n123-45-67891/);
    assert.match(result.provided_text, /반품 배송비 5,000원/);
    assert.ok(result.expanded.includes('판매자 정보'), 'the collapsed seller section is opened');
    // The collapsed product notice is opened and its rows are lifted to the front, past the text cut.
    assert.ok(result.expanded.includes(moreLabel), `the required product notice is expanded (${moreLabel})`);
    const notice = result.provided_text.match(/상품정보 고시\(필수 표기 정보\):\n([\s\S]*?)\n\n/);
    assert.ok(notice, 'the notice section is present');
    assert.match(notice[1], /품명 및 모델명\n테스트 이어폰 TE-1/);
    assert.match(notice[1], /KC 인증정보\nR-R-TST-TE1/);
    assert.match(notice[1], /제조자\(수입자\)\n테스트전자 \/ 테스트무역 유한회사\n제조국\n중국/);
    assert.doesNotMatch(notice[1], /현금거래/);
    }
    // The app accepts phone product paths.
    const browserImport = require('node:fs').readFileSync(path.join(root, 'browserImport.ts'), 'utf8');
    assert.match(browserImport, /v\[pm\]\\\/products/);
    console.log('PASS in-app collector: phone Coupang page, seller table, returns, product notice, message bridge');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
