/* global __dirname */
// Fixture check of the extension on 11st: auto-expanded seller tab, the verification hint, and merging the seller
// window that 11st opens after its CAPTCHA, then Coupang's seller table and its recommendation carousels. Fixture pages
// stand in for both sites; no network, login, or CAPTCHA.
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
const coupangProduct = 'https://www.coupang.com/vp/products/9711633440';
const card = index => `<li><a href="/vp/products/${index}">다른상품 ${index}</a><em>${index},900원</em></li>`;
const coupangPage = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>테스트 이어폰 | 쿠팡</title></head><body>
<main><h1>테스트 이어폰 TE-1</h1><p>12,900원</p><p>판매자: 테스트무역 유한회사</p>
<h2>함께 비교하면 좋을 상품</h2><ul>${[1, 2, 3, 4, 5].map(card).join('')}</ul>
<table><tbody><tr><th><div>상호/대표자</div></th><td>테스트무역 유한회사 / 홍길동</td></tr>
<tr><th><div>통신판매업 신고번호</div></th><td>2026-서울강남-00001</td><th><div>사업자번호</div></th><td>123-45-67891</td></tr></tbody></table></main>
<footer>상호명 및 호스팅 서비스 제공 : 쿠팡(주) 사업자 등록번호 : 120-88-00767</footer></body></html>`;

(async () => {
  const context = await chromium.launchPersistentContext('', { channel: process.env.TEST_BROWSER_CHANNEL || 'msedge',
    headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
  try {
    await context.route('https://www.11st.co.kr/**', route => route.fulfill({ contentType: 'text/html', body: productPage }));
    await context.route('https://m.11st.co.kr/**', route => route.fulfill({ contentType: 'text/html', body: sellerPage }));
    await context.route('https://www.coupang.com/**', route => route.fulfill({ contentType: 'text/html', body: coupangPage }));
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

    // Coupang shows the seller openly, but half the page is other products' cards with their own prices.
    const coupang = await context.newPage();
    await coupang.goto(coupangProduct);
    const listing = await collect(coupang);
    assert.match(listing.text, /^판매자 정보:\n[\s\S]*상호\/대표자\n테스트무역 유한회사 \/ 홍길동[\s\S]*사업자번호\n123-45-67891/);
    assert.match(listing.text, /테스트 이어폰 TE-1\n12,900원/);
    assert.doesNotMatch(listing.text, /다른상품|120-88-00767/);

    // Two pages of the same product go into the compare list, and 비교하기 hands both to a new app tab.
    let posted = null;
    await context.route('http://localhost:8000/group-analyses', route => {
      posted = JSON.parse(route.request().postData()).listings;
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    });
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.evaluate(() => chrome.storage.local.remove('compareList'));
    await popup.close();
    for (const productId of ['111', '222']) {
      const page = await context.newPage();
      await page.goto(`https://www.coupang.com/vp/products/${productId}`);
      await page.bringToFront();
      const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }, { exclude: true }] });
      await cdp.send('Extensions.triggerAction', { id, targetId: targetInfos.find(item => item.url === page.url()).targetId });
      const panel = await context.newPage();
      await panel.goto(`chrome-extension://${id}/popup.html`);
      await page.bringToFront();
      await panel.evaluate(() => document.getElementById('collect').click());
      await panel.waitForFunction(() => !document.getElementById('preview').hidden);
      await panel.evaluate(() => { const box = document.getElementById('consent'); box.checked = true; box.dispatchEvent(new Event('change')); });
      await panel.evaluate(() => document.getElementById('add').click());
      await panel.waitForFunction(count => document.getElementById('compare-count').textContent === `(${count}/10)`, productId === '111' ? 1 : 2);
      if (productId === '222') {
        assert.equal(await panel.locator('#compare-send').isDisabled(), true);
        await panel.evaluate(() => { const box = document.getElementById('compare-consent'); box.checked = true; box.dispatchEvent(new Event('change')); });
        const opened = context.waitForEvent('page', candidate => candidate.url().includes('#safepick-group'));
        await panel.evaluate(() => document.getElementById('compare-send').click());
        const app = await opened;
        await app.waitForFunction(() => /비교 분석에 실패했어요/.test(document.body.innerText), null, { timeout: 30000 });
        assert.equal(posted.length, 2);
        assert.deepEqual(posted.map(item => new URL(item.product_url).pathname), ['/vp/products/111', '/vp/products/222']);
        assert.match(posted[0].provided_text, /테스트무역 유한회사/);
        assert.deepEqual(await app.evaluate(() => sessionStorage.getItem('safepick-group')), null);
      } else { await panel.close(); }
      await page.close();
    }
    console.log('extension seller addon: ok');
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
