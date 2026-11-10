import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
from extractor import unknown_product
from risk_analysis import DetailsDraft, RiskDraft, SignalDraft, validate_risk_draft
from risk_assessment import assess_risk
from schemas import (MailOrderCheck, MarketPrice, OfficialEvidence, OfficialFacts, OfficialLookup, OfficialPageSummary,
                     PriceComparison, ProductComparison, RiskAnalysis, SellerVerification)


def official(status="exact", evidence=True):
    url = "https://www.apple.com/kr/product"
    return ProductComparison(status=status, message="테스트 비교", selected_url=url,
        price=PriceComparison(message="테스트 가격"), pages=[OfficialPageSummary(url=url, title="공식 상품",
        facts=OfficialFacts(match=status, evidence=[OfficialEvidence(field="product_name", quote="테스트 상품")]
                            if evidence else []))])


def unmatched_comparison():
    """A supported brand whose official page could not be matched: the official criterion stays, unchecked."""
    return ProductComparison(status="not_found", message="공식 페이지를 찾지 못했습니다.", price=PriceComparison(message="테스트 가격"))


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
            self.assertIn("공식 상품 동일 여부 또는 판매자 사업자 확인", result.missing_checks)

    def test_active_seller_stands_in_for_the_official_match(self):
        active = SellerVerification(status="active", label="계속사업자")
        result = assess_risk(analyzed(), None, active, MarketPrice(status="no_model"))
        self.assertEqual((result.level, result.missing_checks), ("low", []))
        self.assertIn("공식 상품과의 동일 여부는 확인하지 않았고", result.summary)
        self.assertIn("판매자가 국세청에 정상 등록된 사업자로 조회됩니다.", result.reasons)
        # The stand-in still needs every other axis: terms, an unflagged description, and no low price.
        self.assertEqual(assess_risk(analyzed(returns=False), None, active).level, "undetermined")
        self.assertEqual(assess_risk(analyzed(), None, active, MarketPrice(status="below", ratio_percent=60)).level,
                         "undetermined")
        for status in ["not_found", "unavailable"]:
            self.assertEqual(assess_risk(analyzed(), None, SellerVerification(status=status)).level, "undetermined")

    def test_missing_terms_prevent_low_without_inventing_risk(self):
        for kwargs in [{"shipping": False}, {"returns": False}]:
            result = assess_risk(analyzed(**kwargs), official())
            self.assertEqual(result.level, "undetermined")
            self.assertTrue(result.missing_checks)

    def test_discount_terms_and_urgency_alone_are_only_shown(self):
        quote = "오늘만 90% 할인! 지금 구매하세요."
        # Official malls word discounts and terms loosely too (the 2026-11-10 run flagged LG and Innisfree on them alone,
        # and no risky case), so they stay on the checklist without setting the level.
        for category, said in (("discount_claim", quote), ("ambiguous_conditions", "일부 옵션은 배송 조건이 다를 수 있습니다.")):
            analysis = analyzed([SignalDraft(category=category, quotes=[said])])
            self.assertIn(category, [item.category for item in analysis.checklist if item.kind == "attention"])
            self.assertEqual(assess_risk(analysis, None).level, "undetermined")
        # Official malls show "품절임박 서두르세요" badges, so urgency stays in the checklist without setting the level.
        urgent = analyzed([SignalDraft(category="purchase_pressure", quotes=[quote])])
        self.assertIn("purchase_pressure", [item.category for item in urgent.checklist])
        self.assertEqual(assess_risk(urgent, None).level, "undetermined")

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

    def test_seller_status_sets_the_level(self):
        for status, level in [("closed", "high"), ("unregistered", "high"), ("suspended", "moderate"),
                              ("invalid_number", "moderate"), ("active", "low"),
                              ("not_found", "undetermined"), ("unavailable", "undetermined")]:
            with self.subTest(status=status):
                result = assess_risk(analyzed(), official(), SellerVerification(status=status, label=status))
                self.assertEqual(result.level, level)
                seller = next(item for item in result.criteria if item.key == "seller")
                self.assertEqual(seller.status, {"active": "confirmed", "not_found": "unknown",
                                                 "unavailable": "unknown"}.get(status, "attention"))
                self.assertEqual("판매자 사업자 상태" in result.missing_checks, status != "active")

    def test_marketplace_listed_seller_earns_partial_credit_but_not_low(self):
        listed = SellerVerification(status="marketplace_listed", label="오픈마켓 표시 판매자")
        result = assess_risk(analyzed(), None, listed, MarketPrice(status="typical", label="시세 범위", ratio_percent=95))
        self.assertEqual(result.level, "undetermined")
        self.assertIn("판매자 사업자 상태", result.missing_checks)
        self.assertEqual(next(item for item in result.criteria if item.key == "seller").status, "partial")
        unknown = assess_risk(analyzed(), None, SellerVerification(status="not_found"),
                              MarketPrice(status="typical", label="시세 범위", ratio_percent=95))
        self.assertGreater(result.score, unknown.score)
        self.assertGreater(result.coverage_percent, unknown.coverage_percent)

    def test_mail_order_record_must_agree_with_the_page(self):
        def seller(status):
            return SellerVerification(status="active", label="계속사업자",
                                      mail_order=MailOrderCheck(status=status, label=status))
        for status, level in [("matched", "low"), ("unavailable", "low"), ("domain_differs", "undetermined"), ("name_absent", "undetermined"),
                              ("not_found", "undetermined"), ("mismatch", "moderate"), ("closed", "moderate")]:
            with self.subTest(status=status):
                result = assess_risk(analyzed(), None, seller(status))
                self.assertEqual(result.level, level)
                self.assertEqual("통신판매업 신고 정보" in result.missing_checks,
                                 status in {"domain_differs", "name_absent", "not_found", "mismatch", "closed"})
                criterion = next(item for item in result.criteria if item.key == "seller").status
                self.assertEqual(criterion, {"mismatch": "attention", "closed": "attention",
                                             "domain_differs": "unknown", "name_absent": "unknown", "not_found": "unknown"}.get(status, "confirmed"))
        self.assertIn("통신판매업 신고: mismatch", assess_risk(analyzed(), official(), seller("mismatch")).reasons)
        self.assertIn("페이지의 판매자 정보가 공정위 통신판매업 신고와 일치합니다.",
                      assess_risk(analyzed(), None, seller("matched")).reasons)

    def test_closed_seller_is_high_even_without_description_analysis(self):
        result = assess_risk(RiskAnalysis(), None, SellerVerification(status="closed", label="폐업한 사업자"))
        self.assertEqual(result.level, "high")
        self.assertIn("판매자 사업자 상태: 폐업한 사업자", result.reasons)

    def test_market_price_sets_the_level(self):
        for status, level, criterion in [("far_below", "moderate", "attention"), ("below", "undetermined", "attention"),
                                         ("typical", "low", "confirmed"), ("insufficient", "low", None),
                                         ("no_model", "low", None), ("unavailable", "low", None)]:
            with self.subTest(status=status):
                market = MarketPrice(status=status, label=status, ratio_percent=40)
                result = assess_risk(analyzed(), official(), None, market)
                self.assertEqual(result.level, level)
                # No market to compare against leaves the price out of the score rather than half-checked.
                self.assertEqual(next((item.status for item in result.criteria if item.key == "price"), None), criterion)
                self.assertEqual("가격 시세" in result.missing_checks, status == "below")
        far = assess_risk(analyzed(), None, None, MarketPrice(status="far_below", label="시세보다 지나치게 저렴", ratio_percent=31))
        self.assertEqual(far.level, "moderate")
        self.assertIn("가격 시세: 시세보다 지나치게 저렴 (중앙값의 31%)", far.reasons)

    def test_score_follows_evidence_within_the_level_band(self):
        typical = MarketPrice(status="typical", label="시세 범위", ratio_percent=95)
        active = SellerVerification(status="active", label="계속사업자")
        full = assess_risk(analyzed(), official(), active, typical)
        self.assertEqual((full.level, full.score, full.score_label, full.coverage_percent, full.checked_count),
                         ("low", 100, "근거 양호", 100, 5))
        # An unchecked criterion earns half its weight: official 25 of 100 unknown -> 87.5%, 80 + 20 * 0.875.
        unmatched = assess_risk(analyzed(), unmatched_comparison(), active, typical)
        self.assertEqual((unmatched.level, unmatched.score, unmatched.coverage_percent), ("low", 97, 75))
        # No market for the model and no supported official site leave those criteria out, so the seller and listing
        # carry the score instead of two half-credited gaps, but an uncompared product tops out at 95.
        seller_only = assess_risk(analyzed(), None, active, MarketPrice(status="no_model"))
        self.assertEqual((seller_only.level, seller_only.score, seller_only.coverage_percent,
                          [item.key for item in seller_only.criteria]),
                         ("low", 95, 100, ["description", "purchase_terms", "seller"]))
        # Without either, the same evidence is undetermined, so it cannot read as 근거 양호.
        pending = assess_risk(analyzed(), None, SellerVerification(status="not_found"), typical)
        self.assertEqual((pending.level, pending.score_label), ("undetermined", "대체로 양호"))
        # Far below the market: price 0 of 15, the rest confirmed -> 85%, 30 + 29 * 0.85.
        far_below = MarketPrice(status="far_below", label="시세보다 지나치게 저렴", ratio_percent=40)
        moderate = assess_risk(analyzed(), official(), active, far_below)
        self.assertEqual((moderate.level, moderate.score, moderate.score_label), ("moderate", 54, "주의 필요"))

    def test_score_is_withheld_without_enough_evidence_unless_the_level_is_decisive(self):
        empty = assess_risk(RiskAnalysis(), None, SellerVerification(status="unavailable"), MarketPrice(status="no_model"))
        self.assertEqual((empty.level, empty.score, empty.score_label, empty.coverage_percent), ("undetermined", None, "점수 보류", 0))
        closed = assess_risk(RiskAnalysis(), unmatched_comparison(), SellerVerification(status="closed", label="폐업한 사업자"))
        self.assertEqual((closed.level, closed.score, closed.score_label), ("high", 10, "구매 보류 권장"))
        self.assertLess(closed.coverage_percent, 40)

    @patch("main.check_market_price", return_value=MarketPrice(status="typical", label="시세 범위", ratio_percent=95))
    @patch("main.verify_seller", return_value=SellerVerification(status="active", label="계속사업자"))
    @patch("main.compare_product")
    @patch("main.create_official_lookup")
    @patch("main.extract_product_details", return_value=(unknown_product(), []))
    @patch("main.analyze_listing_risks")
    def test_analysis_and_correction_return_fresh_server_assessment(self, risk, extract, lookup, compare, seller, market):
        lookup.return_value = OfficialLookup(status="found", message="테스트")
        compare.return_value = official()
        risk.return_value = analyzed()
        client = TestClient(main.app)
        response = client.post("/analyses", json={"product_url": "https://shop.example.com/p", "provided_text": "실제 입력 자료"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["risk_analysis"]["assessment"]["level"], "low")
        self.assertEqual(response.json()["seller_verification"]["status"], "active")
        self.assertEqual(response.json()["market_price"]["status"], "typical")
        risk.return_value = analyzed([SignalDraft(category="model_mismatch", quotes=["상품 모델 WH-1000XM5", "상세 모델 WH-1000XM4"])])
        response = client.post("/comparisons", json={"product_url": "https://shop.example.com/p", "product": unknown_product().model_dump(), "sale_text": "보정 후 자료"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["risk_analysis"]["assessment"]["level"], "high")
        self.assertEqual(response.json()["seller_verification"]["status"], "active")


if __name__ == "__main__":
    unittest.main()
