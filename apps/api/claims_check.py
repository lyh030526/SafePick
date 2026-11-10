"""The page's genuineness and official-seller claims and marks, held against who the seller actually is.

A mark or a "공식 판매처" line is easy to copy onto any page, so neither earns anything by itself. A claim counts only
when the seller's registered business is the brand's own company (or the marketplace sells the item itself); a claim the
page contradicts elsewhere (an official import that is also a parallel import, an official store run from abroad) is
a finding. No model calls: the claims and marks come from the product extraction.
"""
import re

from official_brands import find_official_brand
from schemas import ClaimCheck, MarketPrice, PhotoCheck, ProductDetails, SellerVerification

# The companies that sell each supported brand in Korea under their own name.
BRAND_OWNERS = {
    "삼성전자": r"삼성전자",
    "Apple": r"애플\s*코리아|Apple\s*Korea",
    "LG전자": r"엘지전자|LG\s*전자",
    "다이슨": r"다이슨\s*코리아|Dyson",
    "소니": r"소니\s*코리아|소니\s*일렉트로닉스|Sony\s*Korea",
}


def _flat(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def check_claims(product: ProductDetails, seller: SellerVerification | None, text: str,
                 market: MarketPrice | None = None, photo: PhotoCheck | None = None) -> ClaimCheck | None:
    flat = _flat(text)
    # A claim must be on the page word for word; a reworded one is dropped.
    claims = [claim for claim in product.offer.claims if _flat(claim.quote) and _flat(claim.quote) in flat]
    marks = product.offer.marks
    if not claims and not marks:
        return None
    kinds = {claim.kind for claim in claims}
    official = bool(marks) or bool(kinds & {"official_seller", "authorized", "official_import"})
    brand = find_official_brand(product.brand_name)
    owner_pattern = BRAND_OWNERS.get(brand.name) if brand else None
    business = seller.seller.business_name if seller is not None else ""
    owner = bool(owner_pattern and re.search(owner_pattern, business, re.I) and seller is not None and seller.status == "active")
    platform = seller is not None and seller.status == "platform_direct"
    base = dict(claims=claims, marks=marks, brand_owner=brand.name if brand else None)

    contradictions = []
    if "official_import" in kinds and product.condition == "parallel_import":
        contradictions.append("정식 수입품이라고 하면서 병행수입 상품이라고도 적혀 있습니다.")
    if official and seller is not None and seller.status == "overseas":
        contradictions.append("공식·정식 유통이라고 하지만 판매자는 국내 사업자가 아닌 해외 판매자입니다.")
    if official and owner_pattern and seller is not None and seller.status in {"closed", "unregistered", "invalid_number"}:
        contradictions.append(f"{brand.name} 공식 판매라고 하지만 판매자 사업자번호가 정상 사업자로 조회되지 않습니다.")
    if (kinds & {"genuine", "official_seller", "authorized"} or marks) and market is not None and market.status == "far_below":
        contradictions.append(f"정품·공식 판매라고 하지만 가격이 같은 모델 시세 중앙값의 {market.ratio_percent}%입니다.")
    if (kinds & {"genuine", "official_seller", "authorized"} or marks) and photo is not None and photo.status == "overseas_cheap":
        contradictions.append(f"정품·공식 판매라고 하지만 같은 상품 사진이 해외 저가 마켓 {photo.overseas_count}곳에서 쓰입니다.")
    if contradictions:
        return ClaimCheck(status="contradicted", label="정품·공식 주장과 맞지 않는 정보",
                          message=" ".join(contradictions) + " 공식 판매처 여부를 브랜드 공식 사이트에서 직접 확인해 주세요.", **base)
    if owner or (platform and kinds & {"genuine", "official_import"} and not marks):
        return ClaimCheck(status="confirmed", label="판매자 정보와 일치하는 공식 판매" if owner else "마켓 직접 판매",
                          message=(f"판매자가 {brand.name}의 국내 법인({business})으로 국세청에 정상 등록되어 있어, 공식 판매라는 표시와 "
                                   "맞습니다." if owner else "마켓이 직접 판매하는 상품이라 정품 표시를 마켓이 책임집니다.")
                          + " 표시가 맞는다는 뜻이며 상품 상태까지 보증하지는 않습니다.", **base)
    shown = "이미지의 인증 마크" if any(mark.source == "image" for mark in marks) else "공식·인증 표시" if official else "정품 표시"
    return ClaimCheck(status="unverified", label="확인되지 않은 정품·공식 표시",
                      message=f"{shown}가 있지만 판매자가 브랜드 회사가 아니어서 SafePick이 확인할 수 없습니다. 마크와 문구는 쉽게 복사할 수 "
                              "있어 점수에 넣지 않았습니다. 공인 판매점이라면 브랜드 공식 사이트의 판매처 목록에서 상호를 확인해 주세요.",
                      **base)
