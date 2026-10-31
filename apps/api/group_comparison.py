"""Compare several listings of the same product: each one's own assessment, then what only the group shows.

On a marketplace one product is sold by many sellers (a Galaxy phone on Coupang has dozens of pages). The other pages
are the best price reference for an unbranded or unsearchable product, so their median stands in for the market price,
and a page whose model differs from the rest is pointed out. Listings are ranked by level, then score, then price.
"""
import re
import statistics
from collections import Counter

from market_price import rate_ratio
from risk_assessment import assess_risk
from schemas import AnalysisResponse, DomainCheck, GroupAnalysisResponse, GroupListing, MarketPrice, UNKNOWN

ORDER = {"low": 0, "undetermined": 1, "moderate": 2, "high": 3}
KINDS = {"platform_direct": "마켓 직접 판매", "active": "국내 사업자", "overseas": "해외 판매자",
         "marketplace_listed": "오픈마켓 표시 판매자"}


def _price(value: str) -> int | None:
    digits = re.sub(r"[^\d]", "", value or "")
    return int(digits) if digits and int(digits) > 0 else None


def _model(value: str) -> str:
    """A model code such as M2420E1; a spelled-out name ("Redmi Buds 6 Play") is not compared."""
    value = (value or "").strip()
    if value == UNKNOWN or " " in value or not re.search(r"\d", value) or not re.search(r"[A-Za-z]", value):
        return ""
    return re.sub(r"[^0-9A-Z]", "", value.upper())


def group_market(prices: list[int | None], index: int) -> MarketPrice | None:
    """The other pages' median price as this page's market, when at least two others show a price."""
    others = [price for position, price in enumerate(prices) if position != index and price]
    if len(others) < 2 or not prices[index]:
        return None
    median = int(statistics.median(others))
    ratio = round(prices[index] * 100 / median)
    status, label, message = rate_ratio(ratio)
    return MarketPrice(status=status, label=label, ratio_percent=ratio, match_count=len(others),
                       sale_price=f"{prices[index]:,}원", median_price=f"{median:,}원",
                       min_price=f"{min(others):,}원", max_price=f"{max(others):,}원",
                       message=f"같은 상품을 파는 다른 판매 페이지 {len(others)}곳의 중앙값({median:,}원)과 비교했습니다. {message}")


def compare_group(results: list[AnalysisResponse]) -> GroupAnalysisResponse:
    prices = [_price(item.product.price) for item in results]
    models = [_model(item.product.model_number) for item in results]
    common = Counter(model for model in models if model).most_common(1)
    majority = common[0][0] if common and common[0][1] >= 2 else ""
    listings = []
    # The marketplace selling the product itself (Coupang Rocket) proves its price is real, so it is never bait, and a
    # page at or above that price is not too cheap however far below the others it is (overseas resellers mark up).
    direct = [prices[index] for index, item in enumerate(results)
              if item.seller_verification.status == "platform_direct" and prices[index]]
    for index, result in enumerate(results):
        notes = []
        market = result.market_price
        # A web market price found for the model is kept; otherwise the other pages are the reference.
        if market.status not in {"typical", "below", "far_below"}:
            market = group_market(prices, index) or market
            if direct and market.status in {"below", "far_below"} and prices[index] >= min(direct) * 0.9:
                market = market.model_copy(update={
                    "status": "typical", "label": "마켓 직접 판매가 수준",
                    "message": f"다른 판매 페이지보다 싸지만, 마켓이 직접 파는 가격({min(direct):,}원) 수준이라 지나치게 싼 가격으로 보지 "
                               "않습니다."})
        risk = result.risk_analysis
        old = risk.assessment
        comparison = None if result.official_lookup.status == "not_supported" else result.comparison
        domain = old.domain if old is not None else None
        assessment = assess_risk(risk, comparison, result.seller_verification, market,
                                 domain=domain if isinstance(domain, DomainCheck) else None)
        if majority and models[index] and models[index] != majority:
            notes.append(f"모델 표기({result.product.model_number})가 다른 판매 페이지 대부분({majority})과 다릅니다. 판매처 "
                         "상품코드일 수도 있으니 같은 상품·옵션인지 확인해 주세요.")
        if market.ratio_percent is not None and market.match_count and market.ratio_percent >= 150:
            notes.append(f"다른 판매 페이지 중앙값보다 {market.ratio_percent - 100}% 비쌉니다.")
        seller = result.seller_verification
        rating = seller.marketplace_rating
        if rating is not None:
            notes.append(f"마켓 판매자 평가 {rating}% ({seller.rating_count}명)")
        listings.append(dict(
            index=index, product_url=result.source.final_url, page_title=result.source.page_title,
            seller_name=seller.seller.business_name if seller.seller.business_name != UNKNOWN else result.product.seller_name,
            seller_kind=KINDS.get(seller.status, seller.label), price=prices[index],
            price_percent=market.ratio_percent if market.match_count else None,
            model_number=result.product.model_number, level=assessment.level, label=assessment.label,
            score=assessment.score, summary=assessment.summary, notes=notes,
            analysis=result.model_copy(update={"market_price": market,
                                               "risk_analysis": risk.model_copy(update={"assessment": assessment})})))
    listings.sort(key=lambda item: (ORDER[item["level"]], -(item["score"] or 0), item["price"] or float("inf")))
    ranked = [GroupListing(rank=rank, **item) for rank, item in enumerate(listings, 1)]
    known = [price for price in prices if price]
    best = ranked[0]
    low = [item for item in ranked if item.level == "low"]
    cheapest_low = min(low, key=lambda item: item.price or float("inf")) if low else None
    summary = (f"{len(ranked)}곳 중 주의 수준 '낮음'은 {len(low)}곳입니다. 근거가 가장 많은 곳은 {best.seller_name}"
               f"({best.label}{f' {best.score}점' if best.score is not None else ''})입니다."
               + (f" '낮음' 가운데 가장 싼 곳은 {cheapest_low.seller_name}({cheapest_low.price:,}원)입니다."
                  if cheapest_low and cheapest_low.price else "")
               if low else f"{len(ranked)}곳 모두 주의 수준이 '낮음'이 아닙니다. 각 판매 페이지의 확인 항목을 살펴봐 주세요.")
    warnings = ["같은 상품인지는 상품명·모델명으로만 맞춰 봅니다. 옵션(색상·용량·구성)이 다르면 가격 비교가 맞지 않을 수 있습니다.",
                "주의 수준과 점수는 확인한 근거의 요약이며, 판매자의 신뢰도나 정품 여부를 보증하지 않습니다."]
    return GroupAnalysisResponse(listings=ranked, median_price=int(statistics.median(known)) if known else None,
                                 model_number=majority or UNKNOWN, summary=summary, warnings=warnings)
