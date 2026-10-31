/* global chrome, collectProductPage */
const byId = id => document.getElementById(id);
let collected = null;
// The last product capture is kept for this browser session only, so 11st's seller window can be merged into it.
const session = chrome.storage?.session;
byId('consent').addEventListener('change', () => {
  byId('send').disabled = !byId('consent').checked;
  byId('add').disabled = !byId('consent').checked;
});
// Several pages of the same product, gathered one by one as the shopper opens them. Kept in local storage so the list
// survives moving between pages, until the shopper compares or clears it.
const COMPARE_MAX = 10;
const appOrigins = ['http://localhost:8081', 'http://localhost:8082'];
async function compareList() { return (await chrome.storage.local.get('compareList')).compareList || []; }
async function showCompare() {
  const list = await compareList();
  byId('compare').hidden = !list.length;
  byId('compare-count').textContent = `(${list.length}/${COMPARE_MAX})`;
  byId('compare-list').replaceChildren(...list.map((item, index) => {
    const row = document.createElement('li');
    row.textContent = item.page_title || item.product_url;
    const remove = document.createElement('button');
    remove.textContent = '삭제';
    remove.addEventListener('click', async () => {
      await chrome.storage.local.set({ compareList: (await compareList()).filter((_, i) => i !== index) });
      showCompare();
    });
    row.append(remove);
    return row;
  }));
  byId('compare-send').disabled = list.length < 2 || !byId('compare-consent').checked;
}
byId('compare-consent').addEventListener('change', showCompare);
byId('add').addEventListener('click', async () => {
  if (!collected || !byId('consent').checked) return;
  const text = byId('text').value.trim();
  if (!text) { byId('status').textContent = '전달할 상품 설명을 입력해 주세요.'; return; }
  const list = await compareList();
  const item = { ...collected, page_title: byId('title').value, provided_text: text };
  const others = list.filter(entry => entry.product_url !== item.product_url);
  if (others.length >= COMPARE_MAX) { byId('status').textContent = `비교 목록은 최대 ${COMPARE_MAX}곳까지예요.`; return; }
  await chrome.storage.local.set({ compareList: [...others, item] });
  byId('status').textContent = `비교 목록에 추가했어요(${others.length + 1}곳). 같은 상품을 파는 다른 판매 페이지에서도 추가해 주세요.`;
  byId('add').disabled = true;
  showCompare();
});
byId('compare-clear').addEventListener('click', async () => {
  await chrome.storage.local.remove('compareList');
  byId('compare-consent').checked = false;
  showCompare();
});
byId('compare-send').addEventListener('click', async () => {
  const list = await compareList();
  if (list.length < 2 || !byId('compare-consent').checked) return;
  byId('compare-send').disabled = true;
  try {
    const appOrigin = byId('app-origin').value;
    if (!appOrigins.includes(appOrigin)) throw new Error('지원하지 않는 앱 주소');
    // Ten pages are too large for a URL, so the list is handed to the app tab's session storage once it has loaded.
    const tab = await chrome.tabs.create({ url: `${appOrigin}/#safepick-group`, active: false });
    await new Promise(resolve => {
      const done = (id, info) => { if (id === tab.id && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(done); resolve(); } };
      chrome.tabs.onUpdated.addListener(done);
    });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [JSON.stringify(list)], func: data => {
      sessionStorage.setItem('safepick-group', data);
      window.dispatchEvent(new Event('safepick-group'));
    } });
    await chrome.storage.local.remove('compareList');
    await chrome.tabs.update(tab.id, { active: true });
    window.close();
  } catch {
    byId('status').textContent = 'SafePick을 열지 못했습니다. 앱 실행 상태를 확인해 주세요.';
    byId('compare-send').disabled = false;
  }
});
showCompare();
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
    let hint = result.result.hint || '';
    if (result.result.kind === 'seller_addon') {
      const { lastCapture } = await session.get('lastCapture');
      if (!lastCapture || !new URL(lastCapture.product_url).pathname.includes(result.result.product_no)) {
        throw new Error('먼저 11번가 상품 페이지에서 가져오기를 누른 뒤, 보안 문자 창에서 다시 눌러 주세요.');
      }
      collected = { ...lastCapture,
        provided_text: `${result.result.seller_text}

${lastCapture.provided_text}`.slice(0, 12000) };
      hint = '판매자 정보를 상품 페이지 내용에 합쳤어요.';
    } else {
      const { expanded, hint: _hint, ...capture } = result.result;
      collected = capture;
    }
    await session?.set({ lastCapture: collected });
    byId('url').value = collected.product_url;
    byId('title').value = collected.page_title;
    byId('text').value = collected.provided_text;
    byId('consent').checked = false;
    byId('send').disabled = true;
    byId('add').disabled = true;
    byId('preview').hidden = false;
    byId('status').textContent = `${hint ? `${hint} ` : ''}아직 전송하지 않았어요. 내용을 확인하고 불필요한 부분은 지워 주세요.`;
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
