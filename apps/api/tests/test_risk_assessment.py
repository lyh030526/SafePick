import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
from extractor import unknown_product
from risk_analysis import DetailsDraft, RiskDraft, SignalDraft, validate_risk_draft
from risk_assessment import assess_risk
from schemas import (OfficialEvidence, OfficialFacts, OfficialLookup, OfficialPageSummary,
                     PriceComparison, ProductComparison, RiskAnalysis)


def official(status="exact", evidence=True):
    url = "https://www.apple.com/kr/product"
    return ProductComparison(status=status, message="테스트 비교", selected_url=url,
        price=PriceComparison(message="테스트 가격"), pages=[OfficialPageSummary(url=url, title="공식 상품",
        facts=OfficialFacts(match=status, evidence=[OfficialEvidence(field="product_name", quote="테스트 상품")]
                            if evidence else []))])


def analyzed(signals=None, shipping=True, returns=True):
    text = "제품은 테스트 무선 헤드폰입니다. 배송비 3,000원. 수령 후 7일 이내 반품 가능."
    details = {key: [] for key in DetailsDraft.model_fields}
    details.update(description=["제품은 테스트 무선 헤드폰입니다."],
                   shipping=["배송비 3,000원."] if shipping else [],
                   returns=["수령 후 7일 이내 반품 가능."] if returns else [])
    for signal in signals or []:
        text += "\n" + "\n".join(signal.quotes)
    return validate_risk_draft(RiskDraft(details=DetailsDraft(**details), signals=signals or []), text)


class RiskLevelTests(unittest.TestCase):
    def test_low_requires_all_three_axes_with_evidence(self):
        result = assess_risk(analyzed(), official())
        self.assertEqual(result.level, "low")
        self.assertEqual(result.missing_checks, [])
        self.assertTrue(all(item.status == "confirmed" for item in result.criteria))

    def test_search_failure_similarity_and_unsupported_never_prove_low_or_high(self):
        for comparison in [None, official("unknown"), official("not_found"), official("similar"), official(evidence=False)]:
            result = assess_risk(analyzed(), comparison)
            self.assertEqual(result.level, "undetermined")
            self.assertIn("공식 상품 동일 여부", result.missing_checks)

    def test_missing_terms_prevent_low_without_inventing_risk(self):
        for kwargs in [{"shipping": False}, {"returns": False}]:
            result = assess_risk(analyzed(**kwargs), official())
            self.assertEqual(result.level, "undetermined")
            self.assertTrue(result.missing_checks)

    def test_discount_and_pressure_are_moderate_even_without_official_comparison(self):
        quote = "오늘만 90% 할인! 지금 구매하세요."
        for category in ["discount_claim", "purchase_pressure"]:
            result = assess_risk(analyzed([SignalDraft(category=category, quotes=[quote])]), None)
            self.assertEqual(result.level, "moderate")
            self.assertTrue(result.reasons)
            self.assertTrue(result.missing_checks)

    def test_grounded_conflict_overrides_incomplete_information(self):
        for category, quotes in [
            ("model_mismatch", ["상품 모델명 WH-1000XM5", "상세 모델명 WH-1000XM4"]),
            ("components_mismatch", ["USB-C 케이블 기본 포함", "USB-C 케이블 미포함, 별도 구매"]),
        ]:
            result = assess_risk(analyzed([SignalDraft(category=category, quotes=quotes)], returns=False), None)
            self.assertEqual(result.level, "high")
            self.assertTrue(result.missing_checks)

    def test_refuted_candidates_do_not_escalate(self):
        quote = "호환 기종 WH-1000XM5, WH-1000XM4입니다."
        analysis = analyzed([SignalDraft(category="model_mismatch", quotes=[quote])])
        self.assertEqual(assess_risk(analysis, official()).level, "low")

    def test_service_failure_or_insufficient_input_is_always_undetermined(self):
        for status in ["unavailable", "insufficient"]:
            analysis = analyzed([SignalDraft(category="purchase_pressure", quotes=["오늘만 지금 구매하세요!"])])
            analysis.status = status
            self.assertEqual(assess_risk(analysis, official()).level, "undetermined")

    @patch("main.compare_product")
    @patch("main.create_official_lookup")
    @patch("main.extract_product_details", return_value=(unknown_product(), []))
    @patch("main.analyze_listing_risks")
    def test_analysis_and_correction_return_fresh_server_assessment(self, risk, extract, lookup, compare):
        lookup.return_value = OfficialLookup(status="found", message="테스트")
        compare.return_value = official()
        risk.return_value = analyzed()
        client = TestClient(main.app)
        response = client.post("/analyses", json={"product_url": "https://shop.example.com/p", "provided_text": "실제 입력 자료"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["risk_analysis"]["assessment"]["level"], "low")
        risk.return_value = analyzed([SignalDraft(category="model_mismatch", quotes=["상품 모델 WH-1000XM5", "상세 모델 WH-1000XM4"])])
        response = client.post("/comparisons", json={"product_url": "https://shop.example.com/p", "product": unknown_product().model_dump(), "sale_text": "보정 후 자료"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["risk_analysis"]["assessment"]["level"], "high")


if __name__ == "__main__":
    unittest.main()
