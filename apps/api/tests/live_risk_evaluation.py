"""Opt-in live model eval: synthetic cases + previously captured public Naver text."""
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main
from extractor import unknown_product
from risk_analysis import analyze_listing_risks, normalize
from schemas import AnalysisRequest


NORMAL = "DemoBrand SP-100 무선 헤드폰. 구성품: 본체, USB-C 케이블. 색상 블랙. 배송비 3,000원, 2만원 이상 무료배송. 수령 후 7일 이내 미개봉 반품 가능, 반품비 3,000원. 보증 1년."
CASES = [
    ("normal_clear_terms", NORMAL + " 15시 이전 주문 시 오늘 배송. 멤버십 회원 10% 할인, 최대 2천원 쿠폰.", set()),
    ("promotion_and_ambiguous_return", "DemoBrand SP-100 헤드폰 본체입니다. 오늘만 90% 할인! 지금 구매하세요. 배송비 3,000원. 반품은 상황에 따라 가능하며 구체적 기준은 정하지 않습니다.", {"discount_claim", "purchase_pressure", "ambiguous_conditions"}),
    ("conflicting_models", "상품명: DemoBrand 무선 헤드폰. 상품 모델명: WH-1000XM5. 상세정보의 모델명: WH-1000XM4. 판매 옵션은 블랙 한 가지입니다. 배송비 3,000원. 수령 후 7일 이내 미개봉 반품 가능.", {"model_mismatch"}),
    ("conflicting_components", "DemoBrand SP-100 헤드폰, 단일 기본 옵션. 기본 구성품: 본체와 USB-C 케이블 포함. 같은 기본 옵션의 상세 안내: USB-C 케이블 미포함, 별도 구매. 배송비 3,000원. 수령 후 7일 이내 미개봉 반품 가능.", {"components_mismatch"}),
    ("compatible_accessory_not_model_conflict", "DemoBrand 헤드폰 호환 케이스 AC-100. 지원 기종: WH-1000XM5, WH-1000XM4. 판매 상품은 케이스 단품이며 헤드폰 본체는 포함되지 않습니다. 배송비 3,000원. 수령 후 7일 이내 미개봉 반품 가능, 반품비 3,000원.", set()),
]


def evaluate(case):
    name, text, expected = case
    result = analyze_listing_risks(unknown_product(), "가상 판매 페이지 검증", text)
    actual = {item.category for item in result.checklist if item.kind == "attention"}
    quotes_valid = all(normalize(quote) in normalize(text) for item in result.checklist for quote in item.quotes)
    passed = result.status == "completed" and actual == expected and quotes_valid
    return {"case": name, "synthetic": True, "text": text, "expected_attention": sorted(expected),
            "actual_attention": sorted(actual), "quotes_grounded": quotes_valid, "passed": passed, "result": result.model_dump()}


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[3]
    output = root / "docs/validation/2026-10-28/week5"
    output.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=2) as executor:
        reports = list(executor.map(evaluate, CASES))
    captured = json.loads((root / "docs/validation/2026-10-28/naver-window-product/result.json").read_text(encoding="utf-8"))
    result = main.create_analysis(AnalysisRequest(
        product_url=captured["collected_url"], provided_text=captured["collected_text"],
        page_title=captured["collected_title"], input_source="browser_extension", captured_at=captured["checked_at"],
    ))
    risk = result.risk_analysis
    actual = {item.category for item in risk.checklist if item.kind == "attention"}
    grounded = all(normalize(quote) in normalize(captured["collected_text"]) for item in risk.checklist for quote in item.quotes)
    passed = risk.status == "completed" and not actual and grounded and result.product.brand_name == "농심"
    reports.append({"case": "previously_captured_live_naver", "synthetic": False, "fresh_page_fetch": False,
                    "captured_at": captured["checked_at"], "url": captured["collected_url"],
                    "expected_attention": [], "actual_attention": sorted(actual), "quotes_grounded": grounded,
                    "passed": passed, "result": result.model_dump(mode="json")})
    (output / "live-evaluation.json").write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding="utf-8")
    for report in reports:
        print(json.dumps({key: report[key] for key in ("case", "expected_attention", "actual_attention", "quotes_grounded", "passed")}, ensure_ascii=True))
    if not all(report["passed"] for report in reports):
        raise SystemExit("Live risk eval requires review; see report")
