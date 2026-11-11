"""What the listing's required product notice says about who made the product, for brands with no official site to
compare against. Small makers sell on marketplaces without a site of their own, so the notice (제조자·수입자, 제조국,
KC 인증) and whether the seller is the maker itself are what a shopper can still check. Shown only, never scored: the
notice is the seller's own statement."""
import re

from schemas import UNKNOWN, MakerCheck, ProductDetails, SellerVerification

# "상품 상세페이지 참조" and the like point elsewhere instead of naming anyone.
_ELSEWHERE = re.compile(r"상세\s*(?:페이지|설명|정보)?\s*(?:참조|참고)|별도\s*표기|해당\s*(?:없음|사항\s*없음)|^-$")
_SAFETY_LINK = "https://www.safetykorea.kr/release/itemSearch"
_RADIO_LINK = "https://www.rra.go.kr/ko/license/A_b_popup.do"


def _norm(name: str) -> str:
    name = re.sub(r"\b(?:co|ltd|inc|corp|corporation|limited|llc)\b", "", name.lower())
    return re.sub(r"[\s()\[\]㈜·,./\-_]|주식회사|유한회사|\(주\)|\(유\)", "", name)


def _named(value: str) -> bool:
    return bool(value.strip()) and value.strip() != UNKNOWN and not _ELSEWHERE.search(value.strip())


def check_maker(product: ProductDetails, seller: SellerVerification | None) -> MakerCheck:
    notice = product.notice
    maker, importer = notice.maker.strip(), notice.importer.strip()
    kc = [number for number in notice.kc_numbers if number.strip()][:4]
    kc_note = ""
    if kc:
        radio = any(re.match(r"R-[A-Z]-", number, re.I) for number in kc)
        kc_note = (f" KC 인증번호 {', '.join(kc)}는 {'국립전파연구원' if radio else '제품안전정보센터(safetykorea.kr)'}에서 "
                   "같은 제품으로 등록됐는지 조회할 수 있어요.")
    names = [name for name in (maker, importer) if _named(name)]
    seller_names = [name for name in (seller.seller.business_name if seller else "", product.seller_name)
                    if name and name != UNKNOWN]
    same = next((name for name in names for other in seller_names
                 if len(_norm(name)) >= 2 and (_norm(name) in _norm(other) or _norm(other) in _norm(name))), None)
    base = dict(maker=maker if _named(maker) else UNKNOWN, importer=importer if _named(importer) else UNKNOWN,
                origin=notice.origin if _named(notice.origin) else UNKNOWN, kc_numbers=kc,
                kc_link=(_RADIO_LINK if any(re.match(r"R-[A-Z]-", n, re.I) for n in kc) else _SAFETY_LINK) if kc else None)
    # The brand's own Korean company (샥즈코리아 for SHOKZ) writes the maker in English, so a seller whose registered name
    # carries the brand also counts.
    brand = product.brand_name.strip()
    if not same and names and brand != UNKNOWN and len(_norm(brand)) >= 2 and any(_norm(brand) in _norm(name) for name in seller_names):
        same = brand
    if same:
        return MakerCheck(status="seller_is_maker", label="판매자가 제조·수입사", **base,
                          message=f"상품정보 고시의 제조·수입사({same})가 판매자와 같습니다. 만든 회사가 직접 파는 상품이에요."
                                  + kc_note)
    if names:
        return MakerCheck(status="listed", label="제조·수입사 표시됨", **base,
                          message=f"상품정보 고시에 제조·수입사가 {' / '.join(names)}(으)로 적혀 있습니다. 판매자와는 다른 회사라 "
                                  "유통·재판매 상품이에요. 정품 여부가 중요하면 제조사에 구매처를 확인해 보세요." + kc_note)
    if any(value and value != UNKNOWN for value in (maker, importer)):
        return MakerCheck(status="see_detail", label="제조사가 상세페이지에만", **base,
                          message="상품정보 고시에 제조·수입사 대신 '상세페이지 참조'처럼만 적혀 있습니다. 상세 설명에서 제조사와 연락처를 "
                                  "확인해 주세요." + kc_note)
    return MakerCheck(status="missing", label="제조사 정보 없음", **base,
                      message="읽어 온 내용에서 제조·수입사 표시를 찾지 못했습니다. 페이지 아래 '필수 표기 정보'를 펼쳐 확인해 주세요."
                              + kc_note)
