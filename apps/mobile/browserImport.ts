export type BrowserImport = {
  version: 1;
  product_url: string;
  page_title: string;
  provided_text: string;
  captured_at: string;
  input_source: 'browser_extension';
};

export function parseBrowserImport(fragment: string): BrowserImport | null {
  if (!fragment.startsWith('#safepick-import=')) return null;
  if (fragment.length > 150000) throw new Error('전달된 상품 정보가 너무 큽니다. 필요한 설명만 선택해 주세요.');
  try {
    const value = JSON.parse(decodeURIComponent(fragment.slice('#safepick-import='.length)));
    const url = new URL(value.product_url);
    const storeProduct = ['smartstore.naver.com', 'brand.naver.com'].includes(url.hostname)
      && /^\/[^/]+\/products\/\d+\/?$/.test(url.pathname);
    const windowProduct = url.hostname === 'shopping.naver.com'
      && /^\/window-products\/[^/]+\/\d+\/?$/.test(url.pathname);
    if (value.version !== 1 || value.input_source !== 'browser_extension'
        || url.protocol !== 'https:' || url.username || url.password || url.port
        || !(storeProduct || windowProduct)
        || typeof value.page_title !== 'string' || value.page_title.length > 300
        || typeof value.provided_text !== 'string' || !value.provided_text.trim()
        || value.provided_text.length > 12000
        || typeof value.captured_at !== 'string' || !/Z$|[+-]\d{2}:\d{2}$/.test(value.captured_at)
        || !Number.isFinite(Date.parse(value.captured_at))) throw new Error('invalid import');
    return { version: 1, product_url: url.toString(), page_title: value.page_title,
      provided_text: value.provided_text, captured_at: value.captured_at, input_source: 'browser_extension' };
  } catch { throw new Error('확장 프로그램의 상품 정보를 읽지 못했습니다. 상품 페이지에서 다시 보내 주세요.'); }
}
