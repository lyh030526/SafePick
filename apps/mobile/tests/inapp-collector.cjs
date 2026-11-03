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
const page = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>테스트 이어폰 | 쿠팡</title></head><body>
<main><h1>테스트 이어폰 TE-1</h1><p>12,900원</p><p>판매자: 테스트무역 유한회사</p>
<button onclick="document.getElementById('seller').hidden=false">판매자 정보</button>
<div id="seller" hidden><table><tr><th>상호/대표자</th><td>테스트무역 유한회사 / 홍길동</td></tr>
<tr><th>통신판매업 신고번호</th><td>2026-서울강남-00001</td><th>사업자번호</th><td>123-45-67891</td></tr></table></div>
<p>교환/반품: 수령 후 30일 이내 가능, 반품 배송비 5,000원</p></main></body></html>`;

(async () => {
  const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await context.route('https://m.coupang.com/**', route => route.fulfill({ contentType: 'text/html', body: page }));
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
    // The app accepts phone product paths.
    const browserImport = require('node:fs').readFileSync(path.join(root, 'browserImport.ts'), 'utf8');
    assert.match(browserImport, /v\[pm\]\\\/products/);
    console.log('PASS in-app collector: phone Coupang page, seller table, returns, message bridge');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
