/* global __dirname */
// Explicit live check of the user-supplied URL. No fixtures, proxy, login, or AI calls.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../../..');
const url = 'https://shopping.naver.com/window-products/kurlynmart/13807617262';
const output = path.join(root, 'docs/validation/2026-10-28/naver-window-product');

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const context = await chromium.launchPersistentContext('', { channel: 'msedge', headless: true,
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
  const report = { url, checked_at: new Date().toISOString(), live: true, fixture: false, ai_called: false };
  try {
    const cdp = await context.browser().newBrowserCDPSession();
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: path.join(root, 'apps/extension') });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    try {
      const response = await page.goto(url, { waitUntil: 'load', timeout: 45000 });
      report.http_status = response?.status();
    } catch (error) { report.navigation_error = error.message.slice(0, 600); }
    report.final_url = page.url();
    report.page_title = await page.title();
    report.page_text = (await page.locator('body').innerText()).slice(0, 16000);
    await page.screenshot({ path: path.join(output, 'page.png'), fullPage: true });
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }, { exclude: true }] });
    const tab = targetInfos.find(item => item.url === page.url());
    if (!tab) throw new Error('Live tab target not found');
    await page.bringToFront();
    await cdp.send('Extensions.triggerAction', { id, targetId: tab.targetId });
    const all = await cdp.send('Target.getTargets', { filter: [{}] });
    for (const target of all.targetInfos.filter(item => item.type === 'other' && item.url.startsWith(`chrome-extension://${id}/`))) {
      await cdp.send('Target.closeTarget', { targetId: target.targetId });
    }
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await page.bringToFront();
    await popup.evaluate(() => document.getElementById('collect').click());
    await popup.waitForFunction(() => {
      const status = document.getElementById('status').textContent;
      return status && status !== '현재 화면을 읽고 있어요.';
    });
    report.extension_message = await popup.locator('#status').innerText();
    report.extracted = await popup.locator('#preview').isVisible();
    if (report.extracted) {
      report.collected_url = await popup.locator('#url').inputValue();
      report.collected_title = await popup.locator('#title').inputValue();
      report.collected_text = await popup.locator('#text').inputValue();
      report.matches_page_product = report.collected_text.includes('너구링');
    }
    await popup.screenshot({ path: path.join(output, 'extension.png'), fullPage: true });
  } catch (error) { report.test_error = error.message.slice(0, 1000); }
  finally {
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
    const { page_text, collected_text, ...summary } = report;
    console.log(JSON.stringify({ ...summary, page_text_excerpt: page_text?.slice(0, 1400),
      collected_text_length: collected_text?.length || 0 }, null, 2));
    await context.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
