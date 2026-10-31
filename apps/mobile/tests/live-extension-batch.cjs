/* global __dirname */
// Explicit live check: loads the unpacked extension in Edge, collects each given product page, and saves the result.
// Usage: node live-extension-batch.cjs <output-dir> <url> [url...]. No login, CAPTCHA, or AI calls.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../../..');
const [output, ...urls] = process.argv.slice(2);

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const context = await chromium.launchPersistentContext('', { channel: 'msedge', headless: true, locale: 'ko-KR',
    viewport: { width: 1280, height: 900 },
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: path.join(root, 'apps/extension') });
  for (const [index, url] of urls.entries()) {
    const report = { url, checked_at: new Date().toISOString() };
    const page = await context.newPage();
    try {
      const response = await page.goto(url, { waitUntil: 'load', timeout: 45000 });
      report.http_status = response?.status();
      await page.waitForTimeout(3000);
      report.page_title = await page.title();
      const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }, { exclude: true }] });
      const tab = targetInfos.find(item => item.url === page.url());
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
      await popup.waitForFunction(() => document.getElementById('status').textContent !== '현재 화면을 읽고 있어요.', null,
        { timeout: 20000 });
      report.extension_message = await popup.locator('#status').innerText();
      if (await popup.locator('#preview').isVisible()) {
        report.collected_title = await popup.locator('#title').inputValue();
        report.collected_text = await popup.locator('#text').inputValue();
      }
      await popup.close();
    } catch (error) { report.test_error = error.message.slice(0, 600); }
    fs.writeFileSync(path.join(output, `page-${index + 1}.json`), JSON.stringify(report, null, 2));
    const { collected_text, ...summary } = report;
    console.log(JSON.stringify({ ...summary, collected_length: collected_text?.length || 0,
      seller_block: collected_text?.startsWith('판매자 정보:') || false,
      business_number: collected_text?.match(/사업자\s*(등록)?\s*번호\s*[:：]?\s*[\d-]{10,12}/g)?.slice(0, 3) || [] }));
    await page.close();
  }
  await context.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
