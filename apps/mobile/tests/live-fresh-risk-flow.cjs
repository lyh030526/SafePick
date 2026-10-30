/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../../..');
const output = process.env.LIVE_FLOW_OUTPUT || path.join(root, 'docs/validation/2026-10-28/fresh-risk-flow');
const appOrigin = process.env.UI_APP_ORIGIN || 'http://localhost:8082';
const cases = [
  ['blueberries', '블루베리', 'https://shopping.naver.com/window-products/kurlynmart/13613711114'],
  ['milk', '우유', 'https://shopping.naver.com/window-products/kurlynmart/12275421603'],
  ['sony-headphones', 'WH-1000XM5', 'https://brand.naver.com/sonystore/products/6752567809'],
  ['memory-card', '삼성', 'https://smartstore.naver.com/usbmall/products/10186287779'],
  ['tteokbokki', '떡볶이', 'https://smartstore.naver.com/jih2436/products/13238150875'],
  ['stopped-product', '전류', 'https://shopping.naver.com/window-products/kurlynmart/13622696216', true],
  ['stopped-store', '케이스', 'https://smartstore.naver.com/enjoyshop365/products/5262620958', true],
];
const normalize = text => text.replace(/\s+/g, ' ').trim();

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const report = { started_at: new Date().toISOString(), fresh_page_fetch: true, fixtures: false,
    api_mocked: false, app_origin: appOrigin, url_remapped_after_handoff: false,
    method: 'Fresh public page -> installed extension -> user-selected app URL -> actual UI consent -> real API/model -> rendered grade', cases: [] };
  const save = () => fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
  const context = await chromium.launchPersistentContext('', { channel: 'msedge', headless: true,
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
  try {
    const cdp = await context.browser().newBrowserCDPSession();
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: path.join(root, 'apps/extension') });
    for (const [caseId, keyword, url, stopped] of cases.filter(item => !process.env.LIVE_FLOW_CASES || process.env.LIVE_FLOW_CASES.split(',').includes(item[0]))) {
      const result = { id: caseId, url, started_at: new Date().toISOString(), expected_stopped: !!stopped };
      const shop = await context.newPage();
      let popup, app;
      shop.setDefaultTimeout(12000);
      try {
        const navigation = await shop.goto(url, { waitUntil: 'load', timeout: 45000 });
        result.shop_http_status = navigation?.status();
        await shop.getByText('상품정보', { exact: true }).first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
        result.expanded = [];
        for (const label of ['상세정보 펼쳐보기', '상품정보 더보기', '상세정보 더보기', '반품/교환 안내']) {
          const button = shop.getByRole('button', { name: label, exact: true });
          if (await button.count() === 1 && await button.isVisible()) {
            await button.click(); result.expanded.push(label);
          }
        }
        await shop.waitForFunction(() => {
          const current = document.body?.innerText;
          if (window.__safePickFlowText !== current) {
            window.__safePickFlowText = current; window.__safePickFlowChanged = Date.now();
          }
          return Date.now() - window.__safePickFlowChanged > 1200;
        }, undefined, { polling: 200, timeout: 8000 }).catch(() => {});
        result.final_url = shop.url();
        result.page_title = await shop.title();
        await shop.screenshot({ path: path.join(output, `${caseId}-source.png`), fullPage: true });
        const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }, { exclude: true }] });
        const target = targetInfos.find(item => item.url === shop.url());
        assert.ok(target, 'Actual product tab must exist');
        await shop.bringToFront();
        await cdp.send('Extensions.triggerAction', { id, targetId: target.targetId });
        const all = await cdp.send('Target.getTargets', { filter: [{}] });
        for (const target of all.targetInfos.filter(item => item.type === 'other' && item.url.startsWith(`chrome-extension://${id}/`))) {
          await cdp.send('Target.closeTarget', { targetId: target.targetId });
        }
        popup = await context.newPage();
        await popup.goto(`chrome-extension://${id}/popup.html`);
        await shop.bringToFront();
        await popup.evaluate(() => document.getElementById('collect').click());
        await popup.waitForFunction(() => {
          const text = document.getElementById('status').textContent;
          return text && text !== '현재 화면을 읽고 있어요.';
        });
        result.extension_message = await popup.locator('#status').innerText();
        result.collected = await popup.locator('#preview').isVisible();
        if (stopped) {
          assert.equal(result.collected, false);
          assert.match(result.extension_message, /중지/);
          result.passed = true;
          result.outcome = 'stopped_page_rejected_before_ai';
          await popup.screenshot({ path: path.join(output, `${caseId}-extension.png`) });
          continue;
        }
        assert.ok(result.collected, result.extension_message);
        result.collected_text = await popup.locator('#text').inputValue();
        assert.ok(result.collected_text.toLowerCase().includes(keyword.toLowerCase()));
        assert.equal(await popup.locator('#url').inputValue(), url);
        assert.ok(await popup.locator('#send').isDisabled());
        await popup.locator('#app-origin').selectOption(appOrigin);
        await popup.locator('#consent').check();
        await popup.screenshot({ path: path.join(output, `${caseId}-extension.png`) });
        const appPromise = context.waitForEvent('page');
        await popup.locator('#send').click();
        app = await appPromise;
        app.setDefaultTimeout(180000);
        const pageErrors = [];
        app.on('pageerror', error => pageErrors.push(error.message));
        await app.getByText('확장 프로그램에서 가져온 자료', { exact: true }).waitFor();
        assert.equal(new URL(app.url()).origin, appOrigin);
        assert.equal(new URL(app.url()).hash, '');
        assert.equal(await app.getByLabel('상품 링크', { exact: true }).inputValue(), url);
        assert.equal(await app.getByLabel('상품 설명', { exact: true }).inputValue(), result.collected_text);
        const requestBody = [];
        app.on('request', request => {
          if (request.url().endsWith(':8000/analyses') && request.method() === 'POST') requestBody.push(request.postDataJSON());
        });
        await app.getByText('분석 시작', { exact: true }).click();
        await app.getByText('상품 자료의 AI 분석 동의를 확인해 주세요.', { exact: true }).waitFor();
        assert.equal(requestBody.length, 0);
        await app.getByRole('checkbox', { name: '상품 자료 AI 분석 동의' }).click();
        const responsePromise = app.waitForResponse(response => response.url().endsWith(':8000/analyses')
          && response.request().method() === 'POST');
        await app.getByText('분석 시작', { exact: true }).click();
        const response = await responsePromise;
        result.api_http_status = response.status();
        result.response = await response.json();
        assert.equal(response.status(), 200);
        assert.equal(requestBody.length, 1);
        result.submitted = requestBody[0];
        assert.equal(result.submitted.product_url, url);
        assert.equal(result.submitted.provided_text, result.collected_text.trim());
        assert.equal(result.submitted.input_source, 'browser_extension');
        assert.ok(Date.parse(result.submitted.captured_at) >= Date.parse(result.started_at));
        assert.equal(result.response.source.final_url, url);
        assert.equal(result.response.source.kind, 'browser_extension');
        const risk = result.response.risk_analysis;
        assert.equal(risk.status, 'completed');
        assert.ok(result.response.product.product_name.toLowerCase().includes(keyword.toLowerCase()));
        const quotes = [...Object.values(risk.conditions).flatMap(condition => condition.quotes),
          ...risk.checklist.flatMap(check => check.quotes)];
        result.all_quotes_grounded = quotes.every(quote => normalize(result.collected_text).includes(normalize(quote)));
        assert.ok(result.all_quotes_grounded);
        result.level = risk.assessment.level;
        result.label = risk.assessment.label;
        await app.getByLabel(`구매 전 주의 수준 ${result.label}`, { exact: true }).waitFor();
        result.rendered_grade_matches_api = true;
        assert.deepEqual(pageErrors, []);
        result.page_errors = pageErrors;
        await app.setViewportSize({ width: 390, height: 1000 });
        const grade = app.getByLabel(`구매 전 주의 수준 ${result.label}`, { exact: true });
        await grade.scrollIntoViewIfNeeded();
        await grade.screenshot({ path: path.join(output, `${caseId}-grade.png`) });
        result.no_mobile_overflow = await app.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
        assert.ok(result.no_mobile_overflow);
        result.passed = true;
        result.outcome = 'fresh_page_to_rendered_grade_completed';
      } catch (error) {
        result.passed = false;
        result.error = error.message.slice(0, 1000);
        if (app && !app.isClosed()) await app.screenshot({ path: path.join(output, `${caseId}-failure.png`) }).catch(() => {});
      } finally {
        result.finished_at = new Date().toISOString();
        report.cases.push(result); save();
        console.log(JSON.stringify({ id: caseId, passed: result.passed, outcome: result.outcome,
          shop_status: result.shop_http_status, chars: result.collected_text?.length || 0,
          api_status: result.api_http_status, level: result.level, error: result.error }));
        for (const page of [app, popup, shop]) if (page && !page.isClosed()) await page.close();
      }
    }
  } finally { report.finished_at = new Date().toISOString(); save(); await context.close(); }
  if (!report.cases.length || report.cases.some(item => !item.passed)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
