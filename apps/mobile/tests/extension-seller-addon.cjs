/* global __dirname */
// Fixture check of the extension on 11st: auto-expanded seller tab, the verification hint, and merging the seller
// window that 11st opens after its CAPTCHA. Fixture pages stand in for 11st; no network, login, or CAPTCHA.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../../..');
const product = 'https://www.11st.co.kr/products/123456';
const sellerWindow = 'https://m.11st.co.kr/products/mw/pages?area=captcha&prdNo=123456';
const productPage = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>테스트 헤드폰</title></head><body>
<main><h1>테스트 헤드폰 TH-100</h1><p>판매가 99,000원</p><p>노이즈 캔슬링 무선 헤드폰입니다.</p>
<button id="tab" onclick="document.getElementById('seller').hidden=false">판매자정보 (반품/교환)</button>
<div id="seller" hidden><table><tr><th>상호명</th><td>테스트상점</td><th>대표자</th><td>홍길동</td></tr></table>
<p>반품/교환 안내: 수령 후 7일 이내 반품 가능, 반품 배송비 3,000원</p>
<button onclick="window.open('${sellerWindow}')">상세정보 확인</button></div></main>
<footer>상호명 및 호스팅 서비스 제공 : 십일번가(주) 사업자등록번호 : 815-81-01244</footer></body></html>`;
const sellerPage = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>판매자 정보</title></head><body>
<h1>판매자 정보</h1><p>상호명 : 테스트상점</p><p>대표자 : 홍길동</p><p>사업자등록번호 : 123-45-67891</p>
<p>통신판매업신고 : 2024-서울강남-0001</p></body></html>`;

(async () => {
  const context = await chromium.launchPersistentContext('', { channel: process.env.TEST_BROWSER_CHANNEL || 'msedge',
    headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
  try {
    await context.route('https://www.11st.co.kr/**', route => route.fulfill({ contentType: 'text/html', body: productPage }));
    await context.route('https://m.11st.co.kr/**', route => route.fulfill({ contentType: 'text/html', body: sellerPage }));
    const cdp = await context.browser().newBrowserCDPSession();
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: path.join(root, 'apps/extension') });
    const collect = async page => {
      await page.bringToFront();
      const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }, { exclude: true }] });
      await cdp.send('Extensions.triggerAction', { id, targetId: targetInfos.find(item => item.url === page.url()).targetId });
      const all = await cdp.send('Target.getTargets', { filter: [{}] });
      for (const target of all.targetInfos.filter(item => item.type === 'other' && item.url.startsWith(`chrome-extension://${id}/`))) {
        await cdp.send('Target.closeTarget', { targetId: target.targetId });
      }
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${id}/popup.html`);
      await page.bringToFront();
      await popup.evaluate(() => document.getElementById('collect').click());
      await popup.waitForFunction(() => document.getElementById('status').textContent !== '현재 화면을 읽고 있어요.');
      const result = { status: await popup.locator('#status').innerText(), text: await popup.locator('#text').inputValue() };
      await popup.close();
      return result;
    };

    const page = await context.newPage();
    await page.goto(product);
    const first = await collect(page);
    assert.match(first.status, /보안 문자를 직접 풀고/);
    assert.match(first.text, /상호명\n테스트상점/);
    assert.match(first.text, /반품 배송비 3,000원/);
    assert.doesNotMatch(first.text.split('\n\n')[0], /815-81-01244/);

    const window = await context.newPage();
    await window.goto(sellerWindow);
    const merged = await collect(window);
    assert.match(merged.status, /판매자 정보를 상품 페이지 내용에 합쳤어요/);
    assert.match(merged.text, /^판매자 정보:\n[\s\S]*사업자등록번호 : 123-45-67891/);
    assert.match(merged.text, /노이즈 캔슬링 무선 헤드폰입니다/);
    console.log('extension seller addon: ok');
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
