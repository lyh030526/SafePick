/* global chrome, collectProductPage */
const byId = id => document.getElementById(id);
let collected = null;
byId('consent').addEventListener('change', () => { byId('send').disabled = !byId('consent').checked; });
byId('collect').addEventListener('click', async () => {
  collected = null;
  byId('preview').hidden = true;
  byId('status').textContent = '현재 화면을 읽고 있어요.';
  byId('collect').disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('현재 탭을 찾지 못했습니다.');
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectProductPage });
    if (result?.result?.error) throw new Error(result.result.error);
    if (!result?.result) throw new Error('상품 정보를 읽지 못했습니다.');
    collected = result.result;
    byId('url').value = collected.product_url;
    byId('title').value = collected.page_title;
    byId('text').value = collected.provided_text;
    byId('consent').checked = false;
    byId('send').disabled = true;
    byId('preview').hidden = false;
    byId('status').textContent = '아직 전송하지 않았어요. 내용을 확인하고 불필요한 부분은 지워 주세요.';
  } catch (error) {
    byId('status').textContent = error.message || '현재 페이지를 읽지 못했습니다.';
  } finally { byId('collect').disabled = false; }
});
byId('send').addEventListener('click', async () => {
  if (!collected || !byId('consent').checked) return;
  const text = byId('text').value.trim();
  if (!text) { byId('status').textContent = '전달할 상품 설명을 입력해 주세요.'; return; }
  byId('send').disabled = true;
  try {
    const appOrigin = byId('app-origin').value;
    if (!['http://localhost:8081', 'http://localhost:8082'].includes(appOrigin)) throw new Error('지원하지 않는 앱 주소');
    const payload = { ...collected, page_title: byId('title').value, provided_text: text };
    // URL fragment is not sent in an HTTP request. The app removes it immediately on import.
    await chrome.tabs.create({ url: `${appOrigin}/#safepick-import=${encodeURIComponent(JSON.stringify(payload))}` });
    window.close();
  } catch {
    byId('status').textContent = 'SafePick을 열지 못했습니다. 앱 실행 상태를 확인해 주세요.';
    byId('send').disabled = false;
  }
});
