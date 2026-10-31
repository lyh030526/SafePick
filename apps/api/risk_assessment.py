"""Conservative, deterministic purchase-attention levels over validated evidence.

Not a fraud probability or a calibrated seller-reliability model. No model calls.
"""
from dataclasses import dataclass, field

from schemas import MarketPrice, ProductComparison, RiskAnalysis, RiskAssessment, RiskCriterion, SellerVerification

# Evidence score: confirmed criteria earn their weight, attention earns none, unchecked earns half.
WEIGHTS = {"official": 25, "description": 20, "purchase_terms": 15, "seller": 25, "price": 15}
CREDIT = {"confirmed": 1.0, "unknown": 0.5, "attention": 0.0}
# The evidence share is placed proportionally inside its level's band, so the score never reads better or
# worse than the level but still shows how much of the evidence held up.
RANGES = {"high": (0, 29), "moderate": (30, 59), "undetermined": (30, 79), "low": (80, 100)}
MIN_COVERAGE = 40
BANDS = [(80, "근거 양호"), (60, "대체로 양호"), (30, "주의 필요"), (0, "구매 보류 권장")]


@dataclass(frozen=True)
class ScoreParams:
    """Score settings; the calibration tool tries alternatives against labeled cases."""
    weights: dict[str, float] = field(default_factory=lambda: dict(WEIGHTS))
    unknown_credit: float = CREDIT["unknown"]
    min_coverage: int = MIN_COVERAGE


DEFAULT_PARAMS = ScoreParams()


def score_evidence(criteria: list[RiskCriterion], level: str, params: ScoreParams = DEFAULT_PARAMS) -> dict:
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
    score = int(low + (high - low) * raw / 100)
    return {**result, "score": score, "score_label": next(label for floor, label in BANDS if score >= floor)}


def assess_risk(analysis: RiskAnalysis, comparison: ProductComparison | None,
                seller: SellerVerification | None = None, market: MarketPrice | None = None,
                params: ScoreParams = DEFAULT_PARAMS) -> RiskAssessment:
    complete = analysis.status == "completed"
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
    unresolved = [item.title for item in analysis.checklist if item.kind == "needs_check"]
    pending = ([] if official else ["공식 상품 동일 여부"])
    pending += ([] if description else ["상품 상세 설명"])
    pending += ([] if shipping else ["배송 조건"])
    pending += ([] if returns else ["반품·교환 조건"])
    pending += [{"missing_shipping": "배송 조건", "missing_returns": "반품·교환 조건"}.get(item.id, item.title)
                for item in analysis.checklist if item.kind == "needs_check"]
    # A closed or unknown registration is decisive on its own; a suspended or malformed one needs a check.
    seller_block = seller is not None and seller.status in {"closed", "unregistered"}
    seller_warn = seller is not None and seller.status in {"suspended", "invalid_number"}
    if seller is not None and seller.status != "active":
        pending.append("판매자 사업자 상태")
    # Far below the market is a signal; somewhat below needs a reason. No market data is not a risk.
    price_signal = market is not None and market.status == "far_below"
    if market is not None and market.status == "below":
        pending.append("가격 시세")
    pending = list(dict.fromkeys(pending))
    criteria = [
        RiskCriterion(key="official", label="공식 정보 비교", status="confirmed" if official else "unknown",
                      detail="공식 페이지에서 동일 상품의 근거를 확인했습니다." if official
                      else "공식 상품 동일 여부를 확인하지 못했습니다. 미지원·검색 실패 자체를 위험으로 보지 않습니다."),
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
            status="confirmed" if seller.status == "active" else "attention" if seller_block or seller_warn else "unknown",
            detail=f"{seller.label}: {seller.message}"))
    if market is not None:
        criteria.append(RiskCriterion(
            key="price", label="가격 시세",
            status="confirmed" if market.status == "typical" else "attention" if market.status in {"far_below", "below"}
            else "unknown",
            detail=f"{market.label}: {market.message}"))
    price_reason = f"가격 시세: {market.label} (중앙값의 {market.ratio_percent}%)" if price_signal else None
    seller_reason = f"판매자 사업자 상태: {seller.label}" if seller_block or seller_warn else None
    if seller_block or (complete and critical):
        level, label = "high", "높음"
        summary = ("판매자 정보의 사업자등록번호가 국세청에서 정상 사업자로 조회되지 않습니다. 판매자 정보를 확인하기 전에는 구매를 미뤄 주세요."
                   if seller_block else
                   "모델 또는 구성품의 모순을 확인했습니다. 선택 옵션과 판매자 답변을 확인한 뒤 구매를 결정해 주세요.")
        reasons = ([seller_reason] if seller_block else []) + [item.title for item in critical]
    elif not complete:
        level, label = "undetermined", "판단 보류"
        summary = "설명 분석을 완료하지 못해 주의 수준을 정하지 않았습니다. 자료를 추가하거나 다시 분석해 주세요."
        reasons = [analysis.message]
    elif signals or seller_warn or price_signal:
        level, label = "moderate", "보통"
        summary = "추가 확인할 판매 표현이나 조건을 발견했습니다. 원문 근거와 적용 조건을 확인해 주세요."
        reasons = ([seller_reason] if seller_warn else []) + ([price_reason] if price_signal else []) + [item.title for item in signals]
    elif not pending:
        level, label = "low", "낮음"
        summary = "확인한 공식 상품 정보와 판매 설명·구매 조건에서 추가 주의 신호를 찾지 못했습니다. 안전을 보장하지 않습니다."
        reasons = ["공식 상품 일치, 상세 설명, 배송·반품 원문을 확인했습니다."]
        if seller is not None:
            reasons.append("판매자가 국세청에 정상 등록된 사업자로 조회됩니다.")
        if market is not None and market.status == "typical":
            reasons.append("판매가가 같은 모델의 시세 범위 안에 있습니다.")
    else:
        level, label = "undetermined", "판단 보류"
        summary = "확인된 주의 표현은 없지만 필요한 정보가 부족해 낮음으로 분류하지 않았습니다."
        reasons = ["주의 표현이 발견되지 않은 것과 필요한 정보가 확인된 것은 다릅니다."]
    return RiskAssessment(level=level, label=label, summary=summary, reasons=list(dict.fromkeys(reasons)),
                          missing_checks=pending, criteria=criteria, rule_version="4",
                          **score_evidence(criteria, level, params))
