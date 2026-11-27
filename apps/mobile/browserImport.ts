export type BrowserImport = {
  version: 1;
  product_url: string;
  page_title: string;
  provided_text: string;
  captured_at: string;
  input_source: 'browser_extension';
  // The page's main product photo, used only to find where else it appears.
  image_url?: string;
};

// Product detail pages the extension reads: Naver stores, 11st, Coupang, and Gmarket/Auction.
const productPages: [RegExp, RegExp][] = [
  [/^(smartstore|brand)\.naver\.com$/, /^\/[^/]+\/products\/\d+\/?$/],
  [/^shopping\.naver\.com$/, /^\/window-products\/[^/]+\/\d+\/?$/],
  [/^(www|m)\.11st\.co\.kr$/, /^\/products\/(m\/)?\d+\/?$/],
  [/^(www|m)\.coupang\.com$/, /^\/v[pm]\/products\/\d+\/?$/],
  [/^item\.(gmarket|auction)\.co\.kr$/, /^\/(Item|DetailView\/Item\.aspx)$/i],
  // The phone sites: G마켓 moves item links to /vi/product/<no>, 옥션 to mitem.auction.co.kr/vip?itemNo=<no>.
  [/^m\.gmarket\.co\.kr$/, /^\/vi\/product\/\d+\/?$/],
  [/^mitem\.(gmarket|auction)\.co\.kr$/, /^\/(vip|Item)\/?$/i],
];

// The marketplaces the phone app opens in its in-app browser: Coupang, G마켓 and 옥션.
const markets: [string, string][] = [['coupang.com', '쿠팡'], ['gmarket.co.kr', 'G마켓'], ['auction.co.kr', '옥션']];

function marketOf(address: string) {
  try {
    const url = new URL(address);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return markets.find(([site]) => url.hostname === site || url.hostname.endsWith(`.${site}`)) ?? null;
  } catch { return null; }
}

// A link the in-app browser opens itself, including the short links the marketplace apps share.
export function isMarketLink(address: string) {
  return marketOf(address) !== null;
}

// The marketplace's name for the browser's title bar, or '' for any other address.
export function marketName(address: string) {
  return marketOf(address)?.[1] ?? '';
}

// G마켓 and 옥션 still hand out http:// links, which Android refuses to load; the same pages are served over https.
export function secureMarketLink(address: string) {
  return isMarketLink(address) ? address.replace(/^http:\/\//i, 'https://') : address;
}

// A Coupang, G마켓 or 옥션 product detail page the in-app browser can read.
export function isProductPage(address: string) {
  try {
    const url = new URL(address);
    return url.protocol === 'https:' && isMarketLink(address) && productPages.some(([host, path]) => host.test(url.hostname) && path.test(url.pathname));
  } catch { return false; }
}

// Marketplace apps share "상품명 https://link.coupang.com/a/…", so the link is picked out of whatever was copied.
export function findLink(text: string) {
  return text.match(/https?:\/\/[^\s<>"']+/)?.[0] ?? '';
}

export function validCapture(value: unknown): BrowserImport {
  const item = value as Record<string, unknown>;
  const url = new URL(String(item?.product_url));
  if (item.version !== 1 || item.input_source !== 'browser_extension'
      || url.protocol !== 'https:' || url.username || url.password || url.port
      || !productPages.some(([host, path]) => host.test(url.hostname) && path.test(url.pathname))
      || typeof item.page_title !== 'string' || item.page_title.length > 300
      || typeof item.provided_text !== 'string' || !item.provided_text.trim()
      || item.provided_text.length > 12000
      || typeof item.captured_at !== 'string' || !/Z$|[+-]\d{2}:\d{2}$/.test(item.captured_at)
      || !Number.isFinite(Date.parse(item.captured_at))) throw new Error('invalid import');
  const photo = typeof item.image_url === 'string' && /^https:\/\/\S{1,490}$/.test(item.image_url) ? item.image_url : undefined;
  return { version: 1, product_url: url.toString(), page_title: item.page_title,
    provided_text: item.provided_text, captured_at: item.captured_at, input_source: 'browser_extension',
    ...(photo ? { image_url: photo } : {}) };
}

export function parseBrowserImport(fragment: string): BrowserImport | null {
  if (!fragment.startsWith('#safepick-import=')) return null;
  if (fragment.length > 150000) throw new Error('전달된 상품 정보가 너무 큽니다. 필요한 설명만 선택해 주세요.');
  try { return validCapture(JSON.parse(decodeURIComponent(fragment.slice('#safepick-import='.length)))); }
  catch { throw new Error('확장 프로그램의 상품 정보를 읽지 못했습니다. 상품 페이지에서 다시 보내 주세요.'); }
}

// Several pages of the same product, handed over by the extension through session storage (too large for a URL).
export function parseGroupImport(data: string): BrowserImport[] {
  try {
    const items = JSON.parse(data);
    if (!Array.isArray(items) || items.length < 2 || items.length > 10) throw new Error('invalid group');
    return items.map(validCapture);
  } catch { throw new Error('비교 목록을 읽지 못했습니다. 확장 프로그램에서 다시 비교해 주세요.'); }
}
