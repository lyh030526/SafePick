// Runs only when the user clicks the popup button. No network requests or cookies.
function collectProductPage() {
  const url = new URL(location.href);
  const storeProduct = ['smartstore.naver.com', 'brand.naver.com'].includes(url.hostname)
    && /^\/[^/]+\/products\/\d+\/?$/.test(url.pathname);
  const windowProduct = url.hostname === 'shopping.naver.com'
    && /^\/window-products\/[^/]+\/\d+\/?$/.test(url.pathname);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !(storeProduct || windowProduct)) {
    return { error: '네이버 스마트스토어·브랜드스토어 또는 네이버 쇼핑 상품 상세 페이지에서 실행해 주세요.' };
  }
  const root = document.querySelector('main, [role="main"], #content') || document.body;
  const skip = 'script,style,noscript,nav,header,footer,form,input,textarea,select,button,iframe,[contenteditable="true"],[hidden],[aria-hidden="true"]';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts = [];
  let length = 0;
  while (walker.nextNode() && length < 14000) {
    const node = walker.currentNode;
    const parent = node.parentElement;
    if (!parent || parent.closest(skip)) continue;
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden' || !parent.getClientRects().length) continue;
    const text = node.textContent.replace(/\s+/g, ' ').trim();
    if (text) { parts.push(text); length += text.length + 1; }
  }
  const visibleText = parts.join('\n');
  if (/시스템오류|접근.{0,12}제한|비정상적인 접근|access denied|captcha/i.test(document.title)
      || (visibleText.length < 1000 && /접근.{0,12}제한|비정상적인 접근|보안 확인|captcha/i.test(visibleText))) {
    return { error: '접근 제한 또는 보안 확인 화면입니다. 상품 페이지를 정상적으로 연 뒤 다시 시도해 주세요.' };
  }
  if (visibleText.length < 1800 && /운영[이가]?\s*중지|판매\s*중지된\s*상품|존재하지\s*않는\s*상품|삭제된\s*상품/.test(visibleText)) {
    return { error: '판매 또는 스토어 운영이 중지된 페이지입니다. 현재 판매 중인 상품 페이지에서 다시 시도해 주세요.' };
  }
  const products = [];
  function visit(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 8 || products.length >= 3) return;
    if (Array.isArray(value)) { value.slice(0, 30).forEach(item => visit(item, depth + 1)); return; }
    const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
    if (types.includes('Product')) {
      const offers = Array.isArray(value.offers) ? value.offers.slice(0, 5) : [value.offers];
      const name = item => typeof item === 'string' ? item : item?.name;
      products.push({ name: value.name, brand: name(value.brand), model: value.model,
        sku: value.sku, description: typeof value.description === 'string' ? value.description.slice(0, 1500) : undefined,
        offers: offers.filter(Boolean).map(item => ({ price: item.price, priceCurrency: item.priceCurrency,
          seller: name(item.seller), availability: item.availability })) });
    }
    if (value['@graph']) visit(value['@graph'], depth + 1);
  }
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    if (script.textContent.length > 100000) continue;
    try { visit(JSON.parse(script.textContent)); } catch { /* Malformed JSON-LD is optional. */ }
  }
  // The seller disclosure often sits in a collapsed tab or past the text cut, so read its block on its own.
  const sellerBlocks = [];
  const labelWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (labelWalker.nextNode() && sellerBlocks.length < 2) {
    const node = labelWalker.currentNode;
    if (!/사업자\s*(등록)?\s*번호/.test(node.textContent) || node.parentElement?.closest('script,style,footer,form')) continue;
    let block = node.parentElement;
    while (block.parentElement && block.parentElement !== document.body && block.textContent.length < 1500
      && !/상호|대표자/.test(block.textContent)) block = block.parentElement;
    const lines = [];
    const cellWalker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    while (cellWalker.nextNode()) {
      const text = cellWalker.currentNode.textContent.replace(/\s+/g, ' ').trim();
      if (text && !cellWalker.currentNode.parentElement.closest('script,style')) lines.push(text);
    }
    const blockText = lines.join('\n').slice(0, 1500);
    if (/네이버\s*(주식회사|㈜|\(주\))|NAVER\s*Corp/i.test(blockText) || sellerBlocks.includes(blockText)) continue;
    sellerBlocks.push(blockText);
  }
  const seller = sellerBlocks.length ? `판매자 정보:\n${sellerBlocks.join('\n\n')}\n\n` : '';
  const structured = products.length ? `페이지에 포함된 상품 구조화 데이터:\n${JSON.stringify(products).slice(0, 3500)}\n\n화면 텍스트:\n` : '';
  if (visibleText.length < 30 && !products.length) return { error: '읽을 수 있는 상품 설명이 없습니다. 상품 설명을 펼친 뒤 다시 시도해 주세요.' };
  // Preserve the exact product URL, including option query parameters, but never a fragment.
  url.hash = '';
  return { version: 1, product_url: url.toString(), page_title: document.title.slice(0, 300),
    provided_text: (seller + structured + visibleText).slice(0, 12000),
    captured_at: new Date().toISOString(), input_source: 'browser_extension' };
}
