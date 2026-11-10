// Runs only when the user clicks the popup button. No network requests or cookies.
async function collectProductPage() {
  const url = new URL(location.href);
  // Marketplaces must be on a product detail page; other https shops (own malls) are read as they are.
  const marketplaces = [
    [/^(smartstore|brand)\.naver\.com$/, /^\/[^/]+\/products\/\d+\/?$/],
    [/^shopping\.naver\.com$/, /^\/window-products\/[^/]+\/\d+\/?$/],
    [/^(www|m)\.11st\.co\.kr$/, /^\/products\/(m\/)?\d+\/?$/],
    // The phone site (m.coupang.com) serves product pages under /vm/ instead of /vp/.
    [/^(www|m)\.coupang\.com$/, /^\/v[pm]\/products\/\d+\/?$/],
    [/^item\.(gmarket|auction)\.co\.kr$/, /^\/(Item|DetailView\/Item\.aspx)$/i],
  ];
  const market = marketplaces.find(([host]) => host.test(url.hostname));
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    return { error: 'https 상품 상세 페이지에서 실행해 주세요.' };
  }
  // 11st opens the seller's registration in a separate window after the user solves its CAPTCHA. That window is read
  // on its own and merged into the product capture by the popup.
  if (/^(www|m)\.11st\.co\.kr$/.test(url.hostname) && url.pathname.startsWith('/products/mw/pages') && url.searchParams.get('prdNo')) {
    const lines = document.body.innerText.split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const at = lines.findIndex(line => /사업자\s*(등록)?\s*번호/.test(line));
    if (at < 0) return { error: '보안 문자 인증을 마친 뒤, 판매자 정보가 보일 때 다시 눌러 주세요.' };
    return { kind: 'seller_addon', product_no: url.searchParams.get('prdNo'),
      seller_text: `판매자 정보:\n${lines.slice(Math.max(0, at - 12), at + 12).join('\n').slice(0, 1500)}` };
  }
  if (market && !market[1].test(url.pathname) || /(^|\.)naver\.com$/.test(url.hostname) && !market) {
    return { error: '검색 결과나 목록이 아닌 상품 상세 페이지에서 실행해 주세요.' };
  }
  // Marketplace operators print their own registration in footers; it is not the seller.
  const operatorNumber = /220\s*-?\s*81\s*-?\s*62517|120\s*-?\s*88\s*-?\s*00767|815\s*-?\s*81\s*-?\s*01244/;
  const operator = /(네이버|쿠팡|십일번가|11번가|지마켓|G마켓|이베이코리아|인터파크|위메프|티몬)\s*(주식회사|㈜|\(주\))|(주식회사|㈜|\(주\))\s*(네이버|쿠팡|십일번가|지마켓)|NAVER\s*Corp|Coupang\s*Corp|통신판매\s*중개/i;
  const skip = 'script,style,noscript,nav,header,footer,form,input,textarea,select,button,iframe,[contenteditable="true"],[hidden],[aria-hidden="true"]';
  // Recommendation carousels ("이런 상품은 어때요?") list other products, each card with its own price. On Coupang they
  // are half the page and would be read as this listing's claims and prices, so a list of mostly priced cards is skipped.
  const price = /\d{1,3}(,\d{3})+/;
  const isProductList = element => {
    if (element.children.length < 4) return false;
    const cards = [...element.children].filter(child => child.textContent.trim());
    const priced = cards.filter(child => child.textContent.length < 400 && price.test(child.textContent));
    return priced.length >= 4 && priced.length >= cards.length * 0.75;
  };
  const readVisible = () => {
    // Shops render seller and return details in modals outside the main element, so open dialogs count too.
    const roots = [document.querySelector('main, [role="main"], #content') || document.body,
      ...document.querySelectorAll('[role="dialog"], [aria-modal="true"], #MODAL_ROOT_ID')];
    const productLists = roots.flatMap(root => [...root.querySelectorAll('ul, ol, div')].filter(isProductList));
    const lines = [];
    let length = 0;
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode() && length < 60000) {
        const node = walker.currentNode;
        const parent = node.parentElement;
        if (!parent || parent.closest(skip) || productLists.some(list => list.contains(parent))) continue;
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden' || !parent.getClientRects().length) continue;
        const text = node.textContent.replace(/\s+/g, ' ').trim();
        if (text) { lines.push(text); length += text.length + 1; }
      }
    }
    return lines;
  };
  // The seller disclosure often sits in a collapsed tab, a modal, or past the text cut, so read its block on its own.
  const sellerBlocks = [];
  const readSellers = () => {
    const labelWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (labelWalker.nextNode() && sellerBlocks.length < 3) {
      const node = labelWalker.currentNode;
      // Own malls print the seller only in the footer, so footers count; operator blocks are skipped below.
      // Naver and 11st show the number only after a check the user completes, but the trade name and representative
      // are open, so a 상호 label starts a block too.
      if (!/사업자\s*(등록\s*)?번호|사업자\s*등록\s*[:：]?\s*\d|^\s*상호\s*(명)?\s*$/.test(node.textContent)
          || node.parentElement?.closest('script,style,form')) continue;
      let block = node.parentElement;
      // Climb only while the parent stays small, so a label in a large container never pulls in the page header.
      while (block.parentElement && block.parentElement !== document.body && block.parentElement.textContent.length <= 1500
        && !(/대표/.test(block.textContent) && /상호|사업자\s*(등록)?\s*번호/.test(block.textContent))) block = block.parentElement;
      const lines = [];
      const cellWalker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      while (cellWalker.nextNode()) {
        const text = cellWalker.currentNode.textContent.replace(/\s+/g, ' ').trim();
        if (text && !cellWalker.currentNode.parentElement.closest('script,style')) lines.push(text);
      }
      const blockText = lines.join('\n').slice(0, 1500);
      if (operator.test(blockText) || operatorNumber.test(blockText) || sellerBlocks.some(seen => seen.includes(blockText))) continue;
      sellerBlocks.push(blockText);
    }
  };
  // Tabs and modals may hide what was shown before, so keep every read and add only the newly shown lines.
  const parts = [];
  const seen = new Set();
  const read = () => {
    parts.push(...readVisible().filter(line => !seen.has(line) && seen.add(line)));
    readSellers();
  };
  read();
  // Seller, shipping, and return sections are often collapsed or behind tabs. Open those on this page only:
  // never controls that buy, log in, open windows (11st puts the seller number behind a CAPTCHA popup), or navigate.
  const opener = /^(판매자\s*정보.{0,12}|(반품|교환|배송|환불)\s*[/·]?\s*(반품|교환|배송|환불)\s*(정보|안내|규정|정책)?.{0,6}|상품\s*정보\s*제공\s*고시|(상품\s*)?(상세\s*)?(정보|설명)\s*(더\s*보기|펼치기|펼쳐\s*보기)|펼쳐\s*보기)$/;
  const forbidden = /구매|장바구니|결제|주문|로그인|공유|찜|선물|쿠폰|리뷰|문의|확인|팝업/;
  // The product Q&A list is read-only and is where sellers move buyers to KakaoTalk or bank transfers, so its tab is
  // opened; the ask-a-question button (문의하기) still is not.
  const qna = /^상품\s*문의(\s*\(?[\d,]+\)?)?$/;
  const samePage = element => {
    const href = element.tagName === 'A' ? element.getAttribute('href') : null;
    if (!href || /^(#|javascript:)/i.test(href)) return true;
    try {
      const target = new URL(href, location.href);
      return target.origin === location.origin && target.pathname === location.pathname;
    } catch { return false; }
  };
  const clicked = [];
  for (const element of [...document.querySelectorAll('button, a, summary, [role="tab"], [role="button"]')]) {
    if (clicked.length >= 6) break;
    const label = (element.innerText || '').replace(/\s+/g, ' ').trim();
    if (!label || label.length > 24 || clicked.includes(label)
        || !qna.test(label) && (!opener.test(label) || forbidden.test(label))) continue;
    if (element.getAttribute('aria-expanded') === 'true' || element.getAttribute('aria-selected') === 'true'
        || element.target === '_blank' || /window\.open|location/.test(element.getAttribute('onclick') || '')
        || element.closest('form') || !samePage(element) || !element.isConnected || !element.getClientRects().length) continue;
    try { element.click(); clicked.push(label); } catch { continue; }
    await new Promise(resolve => setTimeout(resolve, 700));
    read();
  }
  // Coupang: read the 1-2 star reviews through the read-only star filter, for a complaint summary that does not set the
  // level. A product's reviews mix every seller of it, so each keeps its seller name.
  const lowReviews = [];
  if (/(^|\.)coupang\.com$/.test(url.hostname)) {
    const leaf = test => [...document.querySelectorAll('div, span, li')].find(e => e.childElementCount === 0 && test(e));
    const open = () => leaf(e => e.textContent.trim() === '모든 별점' || /^(최고|좋음|보통|별로|나쁨)$/.test(e.textContent.trim())
      && e.parentElement && /^(최고|좋음|보통|별로|나쁨)$/.test(e.parentElement.textContent.trim()))?.parentElement?.click();
    for (const star of ['나쁨', '별로']) {
      open();
      await new Promise(resolve => setTimeout(resolve, 600));
      const option = leaf(e => e.textContent.trim() === star && e.parentElement
        && new RegExp(`^${star}[\d,]+$`).test(e.parentElement.textContent.replace(/\s/g, '')));
      if (!option || /^\D+0$/.test(option.parentElement.textContent.replace(/\s/g, ''))) continue;
      option.parentElement.click();
      await new Promise(resolve => setTimeout(resolve, 1500));
      const text = document.body.innerText;
      for (const chunk of text.split(/\n(?=\d{4}\.\d{2}\.\d{2}\n)/).slice(1, 7)) {
        const seller = (chunk.match(/판매자:\s*([^\n]+)/) || [])[1];
        if (seller) lowReviews.push(`[${star}] 판매자: ${seller.trim()} | ${chunk.replace(/\s+/g, ' ').slice(0, 220)}`);
      }
    }
  }
  const reviews = lowReviews.length ? `낮은 별점 리뷰:\n${lowReviews.join('\n').slice(0, 2000)}\n\n` : '';
  const visibleText = parts.join('\n').slice(0, 14000);
  // Shipping and return terms often sit at the end of long pages, past the text cut, so lift their lines out first.
  const termLines = [];
  let termLength = 0;
  parts.forEach((line, index) => {
    if (termLength > 2500 || !/반품|교환|환불|청약\s*철회|배송\s*(비|기간|방법|안내|일)/.test(line)) return;
    for (const near of parts.slice(index, index + 4)) {
      if (termLines.includes(near) || termLength > 2500) continue;
      termLines.push(near);
      termLength += near.length + 1;
    }
  });
  const terms = termLines.length ? `배송·반품 안내:\n${termLines.join('\n')}\n\n` : '';
  // Payment or contact moved off the platform often sits in a Q&A answer near the end, past the text cut; lift it out.
  // The marketplace's own warnings ("현금거래를 요구하면 거부하시고") are left where they are.
  const offPlatform = /카카오\s*톡|카톡|오픈\s*채팅|open\.kakao\.com|텔레그램|계좌\s*이체|무통장|현금\s*(결제|거래|입금)|개인\s*계좌|계좌로|입금\s*(부탁|해\s*주)/i;
  const offLines = parts.filter(line => offPlatform.test(line) && !/거부하|신고하|주의하|요구하면|절대|사기\s*거래/.test(line)).slice(0, 8);
  const contact = offLines.length ? `판매자 연락·결제 안내:\n${offLines.join('\n')}\n\n` : '';
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
  const seller = sellerBlocks.length ? `판매자 정보:\n${sellerBlocks.join('\n\n')}\n\n` : '';
  const structured = products.length ? `페이지에 포함된 상품 구조화 데이터:\n${JSON.stringify(products).slice(0, 3500)}\n\n화면 텍스트:\n` : '';
  if (visibleText.length < 30 && !products.length) return { error: '읽을 수 있는 상품 설명이 없습니다. 상품 설명을 펼친 뒤 다시 시도해 주세요.' };
  // Preserve the exact product URL, including option query parameters, but never a fragment.
  url.hash = '';
  // Naver and 11st show the trade name openly but the number only after a verification the user completes.
  const numberShown = sellerBlocks.some(block => /사업자\s*(등록)?\s*번호\s*[:：]?\s*\d{3}\s*-?\s*\d{2}/.test(block));
  const hint = numberShown || !/(^|\.)(naver\.com|11st\.co\.kr)$/.test(url.hostname) ? ''
    : /11st/.test(url.hostname)
      ? "판매자 사업자번호는 보안 문자 뒤에 있어요. '판매자정보' 탭의 '상세정보 확인'에서 보안 문자를 직접 풀고, 열린 창에서 이 버튼을 한 번 더 누르면 판매자 정보를 합쳐요."
      : "판매자 사업자번호는 인증 뒤에 있어요. '판매자 상세정보 확인'의 인증을 직접 마친 뒤 다시 가져오면 사업자 상태까지 확인할 수 있어요.";
  // The main product photo, for finding where else it is used; only an https address is sent.
  const photo = document.querySelector('meta[property="og:image"]')?.content || '';
  return { version: 1, expanded: clicked, hint, product_url: url.toString(), page_title: document.title.slice(0, 300),
    provided_text: (seller + contact + terms + reviews + structured + visibleText).slice(0, 12000),
    captured_at: new Date().toISOString(), input_source: 'browser_extension',
    ...(/^https:\/\/\S{1,490}$/.test(photo) ? { image_url: photo } : {}) };
}
