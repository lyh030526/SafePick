"""Conservative, deterministic purchase-attention levels over validated evidence.

Not a fraud probability or a calibrated seller-reliability model. No model calls.
"""
import re
from dataclasses import dataclass, field
from datetime import date

from schemas import DomainCheck, MarketPrice, ProductComparison, RiskAnalysis, RiskAssessment, RiskCriterion, SellerVerification

# Evidence score: confirmed criteria earn their weight, attention earns none, unchecked earns half.
WEIGHTS = {"official": 25, "description": 20, "purchase_terms": 15, "seller": 25, "price": 15, "history": 25}
# A marketplace-listed seller (trade name and representative shown, number behind verification) is partly checked.
CREDIT = {"confirmed": 1.0, "partial": 0.75, "unknown": 0.5, "attention": 0.0}
# The evidence share is placed proportionally inside its level's band, so the score never reads better or
# worse than the level but still shows how much of the evidence held up.
RANGES = {"high": (0, 29), "moderate": (30, 59), "undetermined": (30, 79), "low": (80, 100)}
# Without an official match or a market price the product itself was never compared, only the seller and the listing,
# so a low level tops out below 100.
UNCOMPARED_CEILING = 95
# A marketplace rating this low from enough buyers is a signal on its own (Coupang: "판매자 평가 60% (15)").
LOW_RATING = 80
MIN_RATINGS = 10
# Years since the mail-order report: five or more is an established seller, two to four a short record.
ESTABLISHED_YEARS = 5
SHORT_RECORD_YEARS = 2
MIN_COVERAGE = 40
BANDS = [(80, "근거 양호"), (60, "대체로 양호"), (30, "주의 필요"), (0, "구매 보류 권장")]


@dataclass(frozen=True)
class ScoreParams:
    """Score settings; the calibration tool tries alternatives against labeled cases."""
    weights: dict[str, float] = field(default_factory=lambda: dict(WEIGHTS))
    unknown_credit: float = CREDIT["unknown"]
    min_coverage: int = MIN_COVERAGE


DEFAULT_PARAMS = ScoreParams()


def score_evidence(criteria: list[RiskCriterion], level: str, params: ScoreParams = DEFAULT_PARAMS,
                   ceiling: int | None = None) -> dict:
    weights = params.weights
    credit = {**CREDIT, "unknown": params.unknown_credit}
    total = sum(weights[item.key] for item in criteria)
    checked = [item for item in criteria if item.status != "unknown"]
    coverage = round(sum(weights[item.key] for item in checked) * 100 / total) if total else 0
    result = {"coverage_percent": coverage, "checked_count": len(checked)}
    # Half credit on mostly unchecked criteria would show a meaningless middle score, unless the level is decisive.
    if not total or (coverage < params.min_coverage and level not in {"high", "moderate"}):
        return result
    raw = sum(weights[item.key] * credit[item.status] for item in criteria) * 100 / total
    low, high = RANGES[level]
    high = min(high, ceiling) if ceiling is not None and level == "low" else high
    score = int(low + (high - low) * raw / 100)
    return {**result, "score": score, "score_label": next(label for floor, label in BANDS if score >= floor)}


def assess_risk(analysis: RiskAnalysis, comparison: ProductComparison | None,
                seller: SellerVerification | None = None, market: MarketPrice | None = None,
                params: ScoreParams = DEFAULT_PARAMS, domain: DomainCheck | None = None,
                today: date | None = None) -> RiskAssessment:
    complete = analysis.status == "completed"
    today = today or date.today()
    # Marketplace detail pages are mostly images, so a component list missing from the text is shown but does not hold
    # the level back; the platform's own order and return flow covers what arrives.
    marketplace = domain is not None and domain.status == "marketplace"
    image_only = {"missing_components"} if marketplace else set()
    # Search status/not_found alone never proves a contradiction or a safe listing.
    official = bool(comparison and comparison.status == "exact" and any(
        page.url == comparison.selected_url and page.facts.match == "exact" and page.facts.evidence
        for page in comparison.pages
    ))
    signals = [item for item in analysis.checklist if complete and item.kind == "attention" and item.quotes]
    critical = [item for item in signals if item.category in {"model_mismatch", "components_mismatch"}
                and len(set(item.quotes)) >= 2]
    description = complete and analysis.conditions.description.status == "found"
    shipping = complete and analysis.conditions.shipping.status == "found"
    returns = complete and analysis.conditions.returns.status == "found"
    # A completed analysis may still have required bundle/option conditions unresolved.
    unresolved = [item.title for item in analysis.checklist if item.kind == "needs_check" and item.id not in image_only]
    # Most brands have no supported official page, so a seller registered as active with the NTS stands in
    # for the official match. A market price below the norm still holds the listing back.
    # The FTC record of the number must agree with the page; a different trade name suggests a borrowed number.
    mail_order = seller.mail_order if seller is not None else None
    mail_warn = mail_order is not None and mail_order.status in {"mismatch", "closed"}
    mail_pending = mail_order is not None and mail_order.status in {"name_absent", "domain_differs", "not_found"}
    # A Rocket item is sold by Coupang itself, which carries the sale and the returns.
    seller_active = seller is not None and (seller.status == "platform_direct" or seller.status == "active"
                                            and (mail_order is None or mail_order.status in {"matched", "unavailable"}))
    # An overseas seller has no Korean registration to check; that is said plainly instead of as a missing number.
    overseas = seller is not None and seller.status == "overseas"
    pending = ([] if official or seller_active else
               ["해외 판매자 (국내 사업자 확인 불가)"] if overseas else ["공식 상품 동일 여부 또는 판매자 사업자 확인"])
    pending += ([] if description else ["상품 상세 설명"])
    pending += ([] if shipping else ["배송 조건"])
    pending += ([] if returns else ["반품·교환 조건"])
    pending += [{"missing_shipping": "배송 조건", "missing_returns": "반품·교환 조건"}.get(item.id, item.title)
                for item in analysis.checklist if item.kind == "needs_check" and item.id not in image_only]
    # A closed or unknown registration is decisive on its own; a suspended or malformed one needs a check.
    seller_block = seller is not None and seller.status in {"closed", "unregistered"}
    seller_warn = seller is not None and seller.status in {"suspended", "invalid_number"}
    if seller is not None and seller.status not in {"active", "platform_direct", "overseas"}:
        pending.append("판매자 사업자 상태")
    rating_warn = (seller is not None and seller.marketplace_rating is not None and seller.rating_count is not None
                   and seller.marketplace_rating < LOW_RATING and seller.rating_count >= MIN_RATINGS)
    if mail_warn or mail_pending:
        pending.append("통신판매업 신고 정보")
    # Far below the market is a signal; somewhat below needs a reason. No market data is not a risk.
    price_signal = market is not None and market.status == "far_below"
    if market is not None and market.status == "below":
        pending.append("가격 시세")
    # A missing or expired domain is decisive on its own; a very new one-year registration is a signal; a new one needs
    # a check. These hold even when the page could not be read. An old domain earns nothing.
    domain_block = domain is not None and domain.status in {"missing", "expired"}
    domain_warn = domain is not None and domain.status == "new_short"
    if domain is not None and domain.status in {"new_short", "new"}:
        pending.append("도메인 운영 기간")
    # A mail-order report filed this year means a seller with no track record yet, the marketplace counterpart of a new
    # domain. The report number starts with its year (2026-용인처인-01238).
    report = (mail_order.report_number if mail_order is not None and mail_order.report_number else
              seller.seller.mail_order_number if seller is not None else "") or ""
    report_year = re.match(r"\D*(\d{4})-", report)
    new_seller = bool(report_year and int(report_year.group(1)) >= today.year) and seller is not None and seller.status == "active"
    if new_seller:
        pending.append("판매자 운영 기간")
    pending = list(dict.fromkeys(pending))
    # A brand without a supported official site, or a model nobody else sells, has no official match or market price to
    # check. Those criteria are left out instead of counting as half-checked, so the seller and listing carry the score.
    criteria = [] if comparison is None else [
        RiskCriterion(key="official", label="공식 정보 비교", status="confirmed" if official else "unknown",
                      detail="공식 페이지에서 동일 상품의 근거를 확인했습니다." if official
                      else "공식 상품 동일 여부를 확인하지 못했습니다. 미지원·검색 실패 자체를 위험으로 보지 않습니다.")]
    criteria += [
        RiskCriterion(key="description", label="판매 설명 검토",
                      status="attention" if signals else "confirmed" if description else "unknown",
                      detail=f"원문이 확인된 주의 항목 {len(signals)}개가 있습니다." if signals
                      else "상세 설명을 분석했고 추가 주의 표현을 찾지 못했습니다." if description
                      else "상품 상세 설명 분석을 충분히 확인하지 못했습니다."),
        RiskCriterion(key="purchase_terms", label="배송·반품 조건",
                      status="confirmed" if shipping and returns and not unresolved else "unknown",
                      detail="배송·반품 관련 원문을 확인했습니다. 모든 세부 조건의 확인을 뜻하지 않습니다."
                      if shipping and returns and not unresolved else "일부 구매 조건을 추가 확인해야 합니다."),
    ]
    if seller is not None:
        criteria.append(RiskCriterion(
            key="seller", label="판매자 사업자 확인",
            status="attention" if seller_block or seller_warn or mail_warn else "confirmed" if seller_active
            else "partial" if seller.status in {"marketplace_listed", "overseas"} else "unknown",
            detail=f"{seller.label}: {seller.message}"
            + (f" 통신판매업 신고: {mail_order.label}." if mail_order is not None else "")
            + (f" {report_year.group(1)}년에 통신판매업을 신고한 신규 판매자입니다." if new_seller else "")
            + (f" 마켓 판매자 평가 {seller.marketplace_rating}% ({seller.rating_count}명)."
               if seller.marketplace_rating is not None else "")))
    # How long the seller has been registered for mail order: the only track record a marketplace page carries.
    if report_year and seller is not None and seller.status == "active":
        years = today.year - int(report_year.group(1))
        criteria.append(RiskCriterion(
            key="history", label="판매자 운영 기간",
            status="confirmed" if years >= ESTABLISHED_YEARS else "partial" if years >= SHORT_RECORD_YEARS else "unknown",
            detail=f"{report_year.group(1)}년에 통신판매업을 신고했습니다"
            + (f"(약 {years}년). 오래 영업한 판매자입니다." if years >= ESTABLISHED_YEARS else
               f"(약 {years}년). 운영 기간이 짧은 편입니다." if years >= SHORT_RECORD_YEARS else
               ". 운영 이력이 거의 없어 확인이 더 필요합니다.") + " 운영 기간은 판매자의 신뢰도를 보증하지 않습니다."))
    if market is not None and market.status in {"typical", "below", "far_below"}:
        criteria.append(RiskCriterion(
            key="price", label="가격 시세",
            status="confirmed" if market.status == "typical" else "attention" if market.status in {"far_below", "below"}
            else "unknown",
            detail=f"{market.label}: {market.message}"))
    price_reason = f"가격 시세: {market.label} (중앙값의 {market.ratio_percent}%)" if price_signal else None
    seller_reason = f"판매자 사업자 상태: {seller.label}" if seller_block or seller_warn else None
    rating_reason = f"판매자 평가: {seller.marketplace_rating}% ({seller.rating_count}명)" if rating_warn else None
    mail_reason = f"통신판매업 신고: {mail_order.label}" if mail_warn else None
    domain_reason = (f"도메인: {domain.label}" + (f" (등록 {domain.registered_on})" if domain.registered_on else "")
                     if domain_block or domain_warn else None)
    if domain_block or seller_block or (complete and critical):
        level, label = "high", "높음"
        summary = ("이 주소의 도메인이 등록되어 있지 않거나 만료되었습니다. 이 주소로는 결제하지 마세요." if domain_block else
                   "판매자 정보의 사업자등록번호가 국세청에서 정상 사업자로 조회되지 않습니다. 판매자 정보를 확인하기 전에는 구매를 미뤄 주세요."
                   if seller_block else
                   "모델 또는 구성품의 모순을 확인했습니다. 선택 옵션과 판매자 답변을 확인한 뒤 구매를 결정해 주세요.")
        reasons = (([domain_reason] if domain_block else []) + ([seller_reason] if seller_block else [])
                   + [item.title for item in critical])
    elif not complete and not domain_warn:
        level, label = "undetermined", "판단 보류"
        summary = "설명 분석을 완료하지 못해 주의 수준을 정하지 않았습니다. 자료를 추가하거나 다시 분석해 주세요."
        reasons = [analysis.message]
    elif signals or seller_warn or mail_warn or price_signal or domain_warn or rating_warn:
        level, label = "moderate", "보통"
        summary = ("최근에 1년만 등록한 도메인의 사이트입니다. 사기 쇼핑몰에서 흔한 형태이니 판매자 정보와 결제 수단을 확인한 뒤 "
                   "구매를 결정해 주세요." if domain_warn and not (signals or seller_warn or mail_warn or price_signal) else
                   "리뷰가 실제 구매 후기가 아닐 수 있는 흔적을 발견했습니다. 리뷰 수와 평점보다 판매자 정보와 반품 조건을 기준으로 "
                   "판단해 주세요." if signals and all(item.category == "review_pattern" for item in signals)
                   and not (seller_warn or mail_warn or price_signal or domain_warn) else
                   f"이 판매자를 평가한 구매자 {seller.rating_count}명 중 만족이 {seller.marketplace_rating}%에 그칩니다. 낮은 평가의 "
                   "이유(배송 지연, 상품 상태 등)를 확인한 뒤 구매를 결정해 주세요." if rating_warn
                   and not (signals or seller_warn or mail_warn or price_signal or domain_warn) else
                   "추가 확인할 판매 표현이나 조건을 발견했습니다. 원문 근거와 적용 조건을 확인해 주세요.")
        reasons = (([domain_reason] if domain_warn else []) + ([seller_reason] if seller_warn else [])
                   + ([rating_reason] if rating_warn else [])
                   + ([mail_reason] if mail_warn else [])
                   + ([price_reason] if price_signal else []) + [item.title for item in signals]
                   + ([f"통신판매업 신고: {report_year.group(1)}년 신고 ({report})"] if new_seller else []))
    elif not pending:
        level, label = "low", "낮음"
        summary = ("확인한 공식 상품 정보와 판매 설명·구매 조건에서 추가 주의 신호를 찾지 못했습니다. 안전을 보장하지 않습니다."
                   if official else
                   "마켓이 직접 판매하는 상품이고, 판매 설명·구매 조건에서 추가 주의 신호를 찾지 못했습니다. 안전을 보장하지 않습니다."
                   if seller is not None and seller.status == "platform_direct" else
                   "판매자 사업자 등록과 판매 설명·구매 조건에서 추가 주의 신호를 찾지 못했습니다. 공식 상품과의 동일 여부는 "
                   "확인하지 않았고, 페이지에 적힌 사업자번호가 실제 판매자의 것인지도 보장하지 않습니다.")
        reasons = ["공식 상품 일치, 상세 설명, 배송·반품 원문을 확인했습니다." if official
                   else "상세 설명과 배송·반품 원문을 확인했습니다."]
        if seller is not None and seller.status == "platform_direct":
            reasons.append("쿠팡이 직접 판매하는 상품입니다.")
        elif seller_active:
            reasons.append("판매자가 국세청에 정상 등록된 사업자로 조회됩니다.")
        if mail_order is not None and mail_order.status == "matched":
            reasons.append("페이지의 판매자 정보가 공정위 통신판매업 신고와 일치합니다.")
        if market is not None and market.status == "typical":
            reasons.append("판매가가 같은 모델의 시세 범위 안에 있습니다.")
    else:
        level, label = "undetermined", "판단 보류"
        summary = ("판매자 등록과 판매 설명·구매 조건은 확인했지만, 올해 통신판매업을 신고한 신규 판매자라 운영 이력이 없습니다. "
                   "낮음으로 분류하지 않았습니다." if pending == ["판매자 운영 기간"] else
                   "국내 사업자등록·통신판매업 신고가 없는 해외 판매자라 국내 기록으로 확인할 수 없습니다. 해외 배송은 반품 비용과 "
                   "기간이 크고 관부가세가 붙을 수 있습니다." if overseas else
                   "확인된 주의 표현은 없지만 필요한 정보가 부족해 낮음으로 분류하지 않았습니다.")
        reasons = ["주의 표현이 발견되지 않은 것과 필요한 정보가 확인된 것은 다릅니다."]
        if new_seller:
            reasons.insert(0, f"통신판매업 신고: {report_year.group(1)}년 신고 ({report})")
    return RiskAssessment(level=level, label=label, summary=summary, reasons=list(dict.fromkeys(reasons)),
                          missing_checks=pending, criteria=criteria, rule_version="10", domain=domain,
                          **score_evidence(criteria, level, params,
                                           None if official or (market is not None and market.status == "typical")
                                           else UNCOMPARED_CEILING))
