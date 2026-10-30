import os
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient
from openai import InternalServerError

import main
from extractor import unknown_product
from risk_analysis import (
    DETAIL_PATTERNS, DetailsDraft, RiskDraft, SignalDraft, analyze_listing_risks, signal_is_supported, validate_risk_draft,
)
from schemas import RiskAnalysis


def draft(signals=None, **details):
    values = {field: [] for field in DetailsDraft.model_fields}
    values.update(details)
    return RiskDraft(details=DetailsDraft(**values), signals=signals or [])


def signal(category, *quotes):
    return SignalDraft(category=category, quotes=list(quotes))


class KoreanBoundaryTests(unittest.TestCase):
    def test_units_and_codes_next_to_korean_text_are_detected(self):
        import re
        self.assertTrue(re.search(DETAIL_PATTERNS["options"], "256GB", re.I))
        self.assertTrue(re.search(DETAIL_PATTERNS["components"], "500ml에 담았습니다", re.I))
        self.assertTrue(re.search(DETAIL_PATTERNS["warranty"], "AS가능", re.I))
        self.assertFalse(re.search(DETAIL_PATTERNS["warranty"], "has", re.I))
        self.assertTrue(signal_is_supported("model_mismatch", ["모델명SM-S928N입니다", "모델명SM-S921N입니다"]))
        self.assertFalse(signal_is_supported("model_mismatch", ["모델명SM-S928N-", "모델명 SM-S928N 입니다"]))


class GroundingTests(unittest.TestCase):
    def test_clear_shipping_return_conditions_have_no_missing_checks(self):
        text = "제품은 무선 헤드폰입니다. 배송비 3,000원, 2만원 이상 무료배송. 미개봉 상품은 수령 후 7일 이내 반품 가능, 반품 배송비 3,000원."
        result = validate_risk_draft(draft(description=["제품은 무선 헤드폰입니다."],
            shipping=["배송비 3,000원, 2만원 이상 무료배송."],
            returns=["미개봉 상품은 수령 후 7일 이내 반품 가능, 반품 배송비 3,000원."]), text)
        self.assertEqual(result.conditions.shipping.status, "found")
        self.assertEqual(result.conditions.returns.status, "found")
        self.assertEqual(result.checklist, [])
        self.assertNotIn("안전 등급", result.message)

    def test_fabricated_quotes_cannot_be_shown_as_evidence(self):
        text = "무선 헤드폰 SP-100, 배송비 3,000원입니다."
        result = validate_risk_draft(draft(shipping=["무료배송입니다."], signals=[
            signal("purchase_pressure", "오늘만 지금 구매하세요!")]), text)
        self.assertEqual(result.conditions.shipping.status, "unknown")
        self.assertFalse(any(item.kind == "attention" for item in result.checklist))
        self.assertTrue(all("오늘만" not in " ".join(item.quotes) for item in result.checklist))

    def test_delivery_deadline_is_not_purchase_pressure_even_if_model_flags_it(self):
        text = "배송 안내: 15시 이전 주문 시 오늘 배송."
        result = validate_risk_draft(draft(signals=[signal("purchase_pressure", text)]), text)
        self.assertFalse(any(item.category == "purchase_pressure" for item in result.checklist))

    def test_live_checkout_delivery_notice_is_not_purchase_pressure(self):
        for text in ["지금 결제 시 모레도착", "지금 결제하면 내일 배송", "지금 구매 시 10.29. 발송 예정"]:
            result = validate_risk_draft(draft(signals=[signal("purchase_pressure", text, "멤버십 시작하고")]),
                                         text + "\n멤버십 시작하고")
            self.assertFalse(any(item.category == "purchase_pressure" for item in result.checklist))

    def test_pressure_evidence_excludes_unrelated_delivery_and_membership(self):
        delivery, urgency, unrelated = "지금 결제 시 모레도착", "오늘만 한정 수량! 지금 구매하세요.", "멤버십 시작하고"
        result = validate_risk_draft(draft(signals=[signal("purchase_pressure", delivery, urgency, unrelated)]),
                                     "\n".join([delivery, urgency, unrelated]))
        check = next(item for item in result.checklist if item.category == "purchase_pressure")
        self.assertEqual(check.quotes, [urgency])

    def test_standard_naver_safety_warning_is_not_seller_pressure(self):
        quote = "판매자가 타 사이트에서 지금 구매를 유도 시 결제하지 마시고 즉시 고객센터로 신고해주세요."
        result = validate_risk_draft(draft(signals=[signal("purchase_pressure", quote)]), quote)
        self.assertFalse(any(item.kind == "attention" for item in result.checklist))

    def test_missing_conditions_mean_uncollected_not_nonexistent(self):
        text = "상품명: 너구링 100g, 가격: 2,250원. 반품/교환안내"
        result = validate_risk_draft(draft(returns=["반품/교환안내"]), text)
        self.assertEqual(result.conditions.returns.status, "unknown")
        self.assertEqual({item.id for item in result.checklist}, {"missing_shipping", "missing_returns"})
        self.assertTrue(all(item.kind == "needs_check" for item in result.checklist))
        self.assertTrue(all("실제 페이지에 정보가 없다는 뜻은 아닙니다" in item.explanation for item in result.checklist))

    def test_whitespace_normalized_quotes_are_grounded(self):
        text = "배송비\n3,000원\t주문 시 결제"
        result = validate_risk_draft(draft(shipping=["배송비 3,000원 주문 시 결제"]), text)
        self.assertEqual(result.conditions.shipping.text, "배송비 3,000원 주문 시 결제")

    def test_double_encoded_live_quotes_are_decoded_but_still_require_source(self):
        text = "배송비\n3,000\n원\n(멤버십 2만원 이상 무료배송)\n신선/냉동 식품은 단순 변심 반품 불가합니다."
        shipping = json.dumps("배송비\n3,000\n원\n(멤버십 2만원 이상 무료배송)", ensure_ascii=False)
        returns = json.dumps("신선/냉동 식품은 단순 변심 반품 불가합니다.", ensure_ascii=False)
        result = validate_risk_draft(draft(shipping=[shipping], returns=[returns]), text)
        self.assertEqual(result.conditions.shipping.status, "found")
        self.assertEqual(result.conditions.returns.status, "found")
        self.assertEqual(result.checklist, [])
        fabricated = json.dumps("배송비 전액 무료입니다.", ensure_ascii=False)
        result = validate_risk_draft(draft(shipping=[fabricated]), text)
        self.assertEqual(result.conditions.shipping.status, "unknown")
        self.assertEqual(result.conditions.shipping.quotes, [])

    def test_food_quantity_and_gifts_are_valid_component_evidence(self):
        for text in ["판매단위 1팩(20구)", "T-F리더기+SD카드 케이스 증정"]:
            result = validate_risk_draft(draft(components=[text]), text)
            self.assertEqual(result.conditions.components.status, "found")

    def test_dom_split_amounts_return_original_source_spacing(self):
        text = "배송비\n3,000\n원\n(멤버십 2만원 이상 무료배송)"
        result = validate_risk_draft(draft(shipping=["배송비 3,000원 (멤버십 2만원 이상 무료배송)"]), text)
        self.assertEqual(result.conditions.shipping.text, "배송비 3,000 원 (멤버십 2만원 이상 무료배송)")
        result = validate_risk_draft(draft(shipping=["배송비 2,000원 (멤버십 2만원 이상 무료배송)"]), text)
        self.assertEqual(result.conditions.shipping.status, "unknown")
        result = validate_risk_draft(draft(shipping=["무료배송"]), "배송비 무료배송")
        self.assertEqual(result.conditions.shipping.status, "found")

    def test_food_package_label_change_does_not_require_a_bundle_list(self):
        text = "패키지 변경 안내: 식품 중량 표기 방식이 조정되었습니다."
        result = validate_risk_draft(draft(), text)
        self.assertNotIn("missing_components", {item.id for item in result.checklist})

    def test_quantity_and_option_headers_alone_are_not_concrete_values(self):
        text = "판매단위 중량/용량 옵션 선택 (필수) 추가 옵션"
        result = validate_risk_draft(draft(components=["판매단위", "중량/용량"],
                                          options=["옵션 선택 (필수)", "추가 옵션"]), text)
        self.assertEqual(result.conditions.components.status, "unknown")
        self.assertEqual(result.conditions.options.status, "unknown")

    def test_free_return_quote_keeps_attached_limits_from_real_page(self):
        text = "무료교환반품\n(최초 1회 무료, 도서산간 지역 별도)\n옵션 선택 (필수)"
        result = validate_risk_draft(draft(returns=["무료교환반품"]), text)
        self.assertEqual(result.conditions.returns.text, "무료교환반품 (최초 1회 무료, 도서산간 지역 별도)")

    def test_model_conflict_requires_two_distinct_codes_and_not_compatible_list(self):
        a, b = "상품 모델명: WH-1000XM5", "상세 모델명: WH-1000XM4"
        result = validate_risk_draft(draft(signals=[signal("model_mismatch", a, b)]), a + "\n" + b)
        self.assertTrue(any(item.category == "model_mismatch" for item in result.checklist))
        for quotes in [(a,), (a, a), ("호환 기종 WH-1000XM5", "지원 기종 WH-1000XM4")]:
            result = validate_risk_draft(draft(signals=[signal("model_mismatch", *quotes)]), "\n".join(quotes))
            self.assertFalse(any(item.category == "model_mismatch" for item in result.checklist))

    def test_components_conflict_requires_inclusion_and_exclusion(self):
        a, b = "구성품: USB-C 케이블 기본 포함", "USB-C 케이블은 별도 구매"
        result = validate_risk_draft(draft(signals=[signal("components_mismatch", a, b)]), a + "\n" + b)
        self.assertTrue(any(item.category == "components_mismatch" for item in result.checklist))
        result = validate_risk_draft(draft(signals=[signal("components_mismatch", b)]), b)
        self.assertFalse(any(item.category == "components_mismatch" for item in result.checklist))
        a = "USB-C 케이블 미포함입니다."
        result = validate_risk_draft(draft(signals=[signal("components_mismatch", a, b)]), a + "\n" + b)
        self.assertFalse(any(item.category == "components_mismatch" for item in result.checklist))
        a = "USB-C 케이블은 기본 제공되지 않습니다."
        result = validate_risk_draft(draft(signals=[signal("components_mismatch", a, b)]), a + "\n" + b)
        self.assertFalse(any(item.category == "components_mismatch" for item in result.checklist))

    def test_strong_promo_and_pressure_keep_real_quotes_and_actions(self):
        text = "오늘만 90% 할인! 지금 구매하세요."
        result = validate_risk_draft(draft(signals=[signal("discount_claim", text), signal("purchase_pressure", text)]), text)
        self.assertEqual({item.category for item in result.checklist if item.kind == "attention"}, {"discount_claim", "purchase_pressure"})
        self.assertTrue(all(item.how_to_check for item in result.checklist))
        self.assertTrue(all(item.quotes == [text] for item in result.checklist if item.kind == "attention"))

    def test_regular_discount_is_not_a_large_discount_signal(self):
        text = "멤버십 회원 10% 할인, 최대 2천원 쿠폰 적용."
        result = validate_risk_draft(draft(signals=[signal("discount_claim", text)]), text)
        self.assertFalse(any(item.category == "discount_claim" for item in result.checklist))
        text = "배터리 잔량 90%에서 충전을 멈춥니다."
        result = validate_risk_draft(draft(signals=[signal("discount_claim", text)]), text)
        self.assertFalse(any(item.category == "discount_claim" for item in result.checklist))

    def test_menu_or_unrelated_quote_cannot_prove_shipping(self):
        text = "판매자: 테스트 스토어입니다. 배송정보"
        result = validate_risk_draft(draft(shipping=["판매자: 테스트 스토어입니다.", "배송정보"]), text)
        self.assertEqual(result.conditions.shipping.status, "unknown")


class RiskModelTests(unittest.TestCase):
    @patch.dict(os.environ, {}, clear=True)
    def test_missing_key_is_unavailable_not_no_risk(self):
        result = analyze_listing_risks(unknown_product(), "상품", "제품은 테스트용 무선 헤드폰이며 상품 설명은 공개된 자료입니다.")
        self.assertEqual(result.status, "unavailable")
        self.assertEqual(result.checklist, [])

    @patch("risk_analysis.OpenAI")
    def test_image_only_or_empty_text_does_not_invent_risk_quotes(self, client):
        self.assertEqual(analyze_listing_risks(unknown_product(), "상품", "").status, "insufficient")
        client.assert_not_called()

    @patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"})
    @patch("risk_analysis.OpenAI")
    def test_invalid_json_is_unavailable(self, client):
        client.return_value.__enter__.return_value.chat.completions.create.return_value = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content='{}'))])
        result = analyze_listing_risks(unknown_product(), "상품", "상품 설명이 있으나 모델의 응답 스키마가 잘못된 상황을 검증하는 테스트입니다.")
        self.assertEqual(result.status, "unavailable")

    @patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"})
    @patch("risk_analysis.OpenAI")
    def test_service_error_is_sanitized_and_not_counted_as_safe(self, client):
        client.return_value.__enter__.return_value.chat.completions.create.side_effect = InternalServerError(
            "PRIVATE-SERVICE-BODY", response=httpx.Response(502, request=httpx.Request("POST", "https://api.example.test")), body=None)
        result = analyze_listing_risks(unknown_product(), "상품", "이 테스트는 충분한 길이의 상품 설명이지만 AI 서비스 오류가 발생한 상황입니다.")
        self.assertEqual(result.status, "unavailable")
        self.assertIn("502", result.message)
        self.assertNotIn("PRIVATE", result.message)


class RiskApiTests(unittest.TestCase):
    @patch("main.compare_product")
    @patch("main.create_official_lookup")
    @patch("main.extract_product_details", return_value=(unknown_product(), []))
    @patch("main.analyze_listing_risks")
    def test_extension_text_reaches_risks_and_corrections_keep_source(self, risks, extract, lookup, compare):
        from schemas import OfficialLookup, PriceComparison, ProductComparison
        lookup.return_value = OfficialLookup(status="not_supported", message="테스트")
        compare.return_value = ProductComparison(message="테스트", price=PriceComparison(message="테스트"))
        risks.return_value = RiskAnalysis(status="completed", message="테스트 체크리스트")
        text = "상세 설명: 테스트 헤드폰입니다. 배송비 3천원, 7일 이내 미개봉 반품 가능."
        client = TestClient(main.app)
        result = client.post("/analyses", json={"product_url": "https://shopping.naver.com/window-products/demo/12345", "provided_text": text, "input_source": "browser_extension"})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["risk_analysis"]["status"], "completed")
        self.assertEqual(result.json()["sale_text"], text)
        self.assertEqual(risks.call_args.args[2], text)
        result = client.post("/comparisons", json={"product_url": "https://shopping.naver.com/window-products/demo/12345", "product": unknown_product().model_dump(), "sale_text": text})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["risk_analysis"]["message"], "테스트 체크리스트")
        self.assertEqual(risks.call_args.args[2], text)


if __name__ == "__main__":
    unittest.main()
