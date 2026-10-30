/* global __dirname */
// Opt-in live public pages + the real extension. Never substitutes page responses.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../../..');
const output = process.env.LIVE_PRODUCT_OUTPUT || path.join(root, 'docs/validation/2026-10-28/week5-real-products');
const cases = [
  ['snack', '너구링', 'https://shopping.naver.com/window-products/kurlynmart/13807617262'],
  ['blueberries', '블루베리', 'https://shopping.naver.com/window-products/kurlynmart/13613711114'],
  ['eggs', '백색란', 'https://shopping.naver.com/window-products/kurlynmart/12274531655'],
  ['milk', '우유', 'https://shopping.naver.com/window-products/kurlynmart/12275421603'],
  ['bulgogi', '불고기', 'https://shopping.naver.com/window-products/kurlynmart/12274346655'],
  ['pancakes-options', '전류', 'https://shopping.naver.com/window-products/kurlynmart/13622696216'],
  ['jjamppong-options', '짬뽕', 'https://shopping.naver.com/window-products/kurlynmart/12273079554'],
  ['dumplings', '왕만두', 'https://shopping.naver.com/window-products/kurlynmart/13633941759'],
  ['sony-headphones', 'WH-1000XM5', 'https://brand.naver.com/sonystore/products/6752567809'],
  ['memory-card', '삼성', 'https://smartstore.naver.com/usbmall/products/10186287779'],
  ['headphone-accessory', '케이스', 'https://smartstore.naver.com/enjoyshop365/products/5262620958'],
  ['tteokbokki', '떡볶이', 'https://smartstore.naver.com/jih2436/products/13238150875'],
];

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const report = { checked_at: new Date().toISOString(), live_network: true, fixtures: false,
    method: 'isolated Edge + installed extension activeTab; no login/proxy/security bypass', cases: [] };
  const save = () => fs.writeFileSync(path.join(output, 'collection.json'), JSON.stringify(report, null, 2));
  const context = await chromium.launchPersistentContext('', { channel: 'msedge', headless: true,
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
  try {
    const cdp = await context.browser().newBrowserCDPSession();
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: path.join(root, 'apps/extension') });
    for (const [caseId, expectedKeyword, url] of cases.filter(item => !process.env.LIVE_PRODUCT_CASES || process.env.LIVE_PRODUCT_CASES.split(',').includes(item[0]))) {
      const result = { id: caseId, expected_keyword: expectedKeyword, requested_url: url, checked_at: new Date().toISOString() };
      const page = await context.newPage();
      let popup;
      page.setDefaultTimeout(10000);
      try {
        try {
          const response = await page.goto(url, { waitUntil: 'load', timeout: 30000 });
          result.http_status = response?.status();
        } catch (error) { result.navigation_error = error.message.slice(0, 400); }
        // Wait for rendered product facts, not search snippets or a replacement URL.
        await page.waitForFunction(() => document.body?.innerText.length > 700, { timeout: 8000 }).catch(() => {});
        await page.getByText('상품정보', { exact: true }).first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
        result.final_url = page.url();
        result.page_title = await page.title();
        result.visible_controls = await page.locator('button').allTextContents();
        result.expanded_controls = [];
        // Open only read-only product/return information controls, never ordering or login.
        for (const label of ['상세정보 펼쳐보기', '상품정보 더보기', '상세정보 더보기', '반품/교환 안내']) {
          const button = page.getByRole('button', { name: label, exact: true });
          if (await button.count() === 1 && await button.isVisible()) {
            await button.click();
            result.expanded_controls.push(label);
          }
        }
        await page.waitForFunction(() => {
          const text = document.body?.innerText;
          if (window.__safePickLiveText !== text) {
            window.__safePickLiveText = text;
            window.__safePickLiveTextChanged = Date.now();
          }
          return Date.now() - window.__safePickLiveTextChanged > 1000;
        }, undefined, { polling: 200, timeout: 8000 }).catch(() => {});
        result.page_text = (await page.locator('body').innerText()).slice(0, 30000);
        result.main_heading = await page.locator('h1,h2,h3').allTextContents();
        result.images = await page.locator('img').evaluateAll(images => images.slice(0, 15).map(img => ({ alt: img.alt, width: img.naturalWidth, height: img.naturalHeight })));
        await page.screenshot({ path: path.join(output, `${caseId}-page.png`), fullPage: true });
        const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }, { exclude: true }] });
        const tab = targetInfos.find(item => item.url === page.url());
        if (!tab) throw new Error('Live tab target not found');
        await page.bringToFront();
        await cdp.send('Extensions.triggerAction', { id, targetId: tab.targetId });
        const all = await cdp.send('Target.getTargets', { filter: [{}] });
        for (const target of all.targetInfos.filter(item => item.type === 'other' && item.url.startsWith(`chrome-extension://${id}/`))) {
          await cdp.send('Target.closeTarget', { targetId: target.targetId });
        }
        popup = await context.newPage();
        await popup.goto(`chrome-extension://${id}/popup.html`);
        await page.bringToFront();
        await popup.evaluate(() => document.getElementById('collect').click());
        await popup.waitForFunction(() => {
          const status = document.getElementById('status').textContent;
          return status && status !== '현재 화면을 읽고 있어요.';
        });
        result.extension_message = await popup.locator('#status').innerText();
        result.extracted = await popup.locator('#preview').isVisible();
        if (result.extracted) {
          result.collected_url = await popup.locator('#url').inputValue();
          result.collected_title = await popup.locator('#title').inputValue();
          result.collected_text = await popup.locator('#text').inputValue();
          result.exact_url_preserved = result.collected_url === url;
          result.expected_product_visible = result.collected_text.toLowerCase().includes(expectedKeyword.toLowerCase());
          result.collected_at = new Date().toISOString();
        }
        await popup.screenshot({ path: path.join(output, `${caseId}-extension.png`), fullPage: true });
      } catch (error) { result.test_error = error.message.slice(0, 700); }
      finally {
        report.cases.push(result);
        save();
        console.log(JSON.stringify({ id: caseId, http_status: result.http_status, extracted: result.extracted,
          title: result.page_title, chars: result.collected_text?.length || 0,
          expected_product_visible: result.expected_product_visible, error: result.test_error,
          message: result.extracted ? undefined : result.extension_message }));
        if (popup) await popup.close();
        await page.close();
      }
    }
  } finally { save(); await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
