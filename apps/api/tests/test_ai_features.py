"""The conversation check, the option-price rule, and questions answered from an analysis' own findings."""
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
from chat_check import check_conversation
from extractor import _normalize_product
from market_price import check_market_price, option_bait
from question_answer import answer_question, evidence
from risk_assessment import assess_risk
from schemas import (AnalysisQuestion, ConversationCheckRequest, DomainCheck, MarketPrice, ProductDetails, ProductOption,
                     RiskAnalysis, RiskAssessment, SellerVerification)
from tests.test_risk_assessment import analyzed


def completion(payload):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(payload, ensure_ascii=False)))])


def product(price="9,900", options=(), condition="unknown"):
    return ProductDetails(brand_name="소니", product_name="노이즈캔슬링 헤드폰", model_number="WH-1000XM5", price=price,
                          currency="KRW", seller_name="테스트스토어", components=["헤드폰"], options=list(options),
                          condition=condition)


@patch.dict(os.environ, {"OPENAI_API_KEY": ""})
class ConversationRulesTests(unittest.TestCase):
    """Without the model, the fixed patterns and the channel still decide."""

    def test_personal_account_deposit_is_high_and_the_number_is_masked(self):
        result = check_conversation(ConversationCheckRequest(text="나: 이거 재고 있나요?\n상대: 네 있어요\n"
                                                                  "상대: 국민은행 123456-12-345678 로 입금해주시면 바로 발송해요"))
        self.assertEqual(result.level, "high")
        self.assertEqual(result.signals[0].kind, "off_platform_payment")
        self.assertNotIn("12-345678", result.signals[0].quote)
        self.assertIn("123456-****-", result.signals[0].quote)
        self.assertTrue(any("AI 검토를 하지 못해" in warning for warning in result.warnings))

    def test_buyer_lines_and_platform_warnings_are_not_signals(self):
        result = check_conversation(ConversationCheckRequest(
            text="나: 계좌이체하면 할인돼요?\n상대: 아니요 현금거래를 요구하면 거부하시고 신고해 주세요\n상대: 주문은 앱에서 해 주세요",
            channel="marketplace"))
        self.assertEqual(result.level, "low")
        self.assertEqual(result.signals, [])

    def test_a_messenger_conversation_is_moved_off_the_platform(self):
        result = check_conversation(ConversationCheckRequest(text="상대: 안녕하세요 문의 주신 상품 발송 가능합니다", channel="messenger"))
        self.assertEqual(result.level, "moderate")
        self.assertEqual(result.signals[0].kind, "off_platform_contact")

    def test_too_little_text_is_not_judged(self):
        self.assertEqual(check_conversation(ConversationCheckRequest(text="네")).level, "undetermined")

    @patch("chat_check.check_domain")
    def test_a_new_short_payment_domain_is_high_and_a_marketplace_link_is_not(self, domain):
        domain.return_value = DomainCheck(status="new_short", label="최근 1년 단기 등록", message="등록 3일")
        result = check_conversation(ConversationCheckRequest(
            text="상대: 상품은 https://www.coupang.com/vp/products/1 이고요\n상대: 결제는 coupang-safepay.shop/pay 에서 해주세요"))
        statuses = {link.domain: link.status for link in result.links}
        self.assertEqual(statuses["coupang.com"], "marketplace")
        self.assertIn(statuses["coupang-safepay.shop"], {"new_short", "impersonates"})
        self.assertEqual(result.level, "high")


@patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"})
class ConversationModelTests(unittest.TestCase):
    @patch("chat_check.OpenAI")
    def test_model_signals_count_only_when_quoted_word_for_word(self, client):
        client.return_value.chat.completions.create.return_value = completion({"signals": [
            {"kind": "refund_lure", "quote": "환불하려면 수수료 3만원 먼저 보내주세요"},
            {"kind": "personal_info", "quote": "인증번호 알려주세요"},  # not in the conversation
        ]})
        result = check_conversation(ConversationCheckRequest(text="상대: 주문이 취소됐어요\n상대: 환불하려면 수수료 3만원 먼저 보내주세요"))
        self.assertEqual([signal.kind for signal in result.signals], ["refund_lure"])
        self.assertEqual(result.level, "high")

    @patch("chat_check.OpenAI")
    def test_the_same_line_found_twice_is_listed_once(self, client):
        client.return_value.chat.completions.create.return_value = completion({"signals": [
            {"kind": "off_platform_payment", "quote": "신한은행 110-123-456789 로 입금하시면 5천원 더 빼드릴게요"},
            {"kind": "payment_link", "quote": "안전결제 링크로 결제해 주세요 pay.example.shop"},
            {"kind": "fake_safe_payment", "quote": "안전결제 링크로 결제해 주세요 pay.example.shop"}]})
        with patch("chat_check.check_domain", return_value=DomainCheck(status="established", label="오래된 도메인")):
            result = check_conversation(ConversationCheckRequest(text="상대: 안전결제 링크로 결제해 주세요 pay.example.shop\n"
                                                                      "상대: 신한은행 110-123-456789 로 입금하시면 5천원 더 빼드릴게요"))
        self.assertEqual(sorted(signal.kind for signal in result.signals), ["fake_safe_payment", "off_platform_payment"])
        self.assertFalse(any(signal.quote.startswith("상대:") for signal in result.signals))

    @patch("chat_check.OpenAI")
    def test_urgency_alone_is_shown_but_does_not_raise_the_level(self, client):
        client.return_value.chat.completions.create.return_value = completion({"signals": [
            {"kind": "urgency", "quote": "오늘만 이 가격이에요"}]})
        result = check_conversation(ConversationCheckRequest(text="상대: 오늘만 이 가격이에요\n상대: 앱에서 주문해 주세요",
                                                             channel="marketplace"))
        self.assertEqual(result.level, "low")
        self.assertEqual(result.signals[0].severity, "info")

    def test_endpoint_needs_some_conversation(self):
        response = TestClient(main.app).post("/conversation-checks", json={"channel": "messenger"})
        self.assertEqual(response.status_code, 422)


class OptionPriceTests(unittest.TestCase):
    def test_a_shown_price_far_below_every_product_option_is_bait(self):
        listing = product(options=[ProductOption(name="전용 케이스", price="9900", kind="addon"),
                                   ProductOption(name="헤드폰 블랙", price="389000"),
                                   ProductOption(name="헤드폰 실버", price="399000")])
        self.assertEqual(option_bait(listing)[0], 389000)
        with patch.dict(os.environ, {"SERPER_API_KEY": ""}):
            market = check_market_price(listing)
        self.assertTrue(market.option_bait)
        self.assertEqual(market.option_price, "389000")

    def test_surcharges_add_to_the_shown_price(self):
        self.assertIsNotNone(option_bait(product(price="10000", options=[ProductOption(name="본품", price="+15000")])))
        self.assertIsNone(option_bait(product(price="10000", options=[ProductOption(name="블랙", price="+0"),
                                                                      ProductOption(name="화이트", price="+15000")])))
        self.assertIsNone(option_bait(product(price="389000", options=[ProductOption(name="블랙", price="389000")])))

    def test_refurbished_is_not_compared_with_new(self):
        market = check_market_price(product(condition="refurbished"))
        self.assertEqual(market.status, "not_new")

    def test_bait_holds_the_listing_at_moderate(self):
        active = SellerVerification(status="active", label="계속사업자", message="정상")
        market = MarketPrice(status="no_model", option_bait=True, option_price="389000", option_note="대표 가격 차이")
        result = assess_risk(analyzed(), None, active, market)
        self.assertEqual(result.level, "moderate")
        self.assertIn("대표 가격과 실제 옵션 가격 차이 (옵션 최저가 389,000원)", result.reasons)
        self.assertEqual(result.rule_version, "15")

    def test_extraction_reads_options_and_condition(self):
        parsed = _normalize_product({"brand_name": "소니", "options": [
            {"name": "블랙", "price": "+5,000원", "kind": "main"}, {"name": "케이블", "price": "3,000원", "kind": "addon"},
            {"name": "", "price": "1"}, "잘못된 항목"], "condition": "refurbished"})
        self.assertEqual([(option.name, option.price, option.kind) for option in parsed.options],
                         [("블랙", "+5000", "main"), ("케이블", "3000", "addon")])
        self.assertEqual(parsed.condition, "refurbished")
        self.assertEqual(_normalize_product({"condition": "brand_new"}).condition, "unknown")


def question(text="반품은 어떻게 해야 해?"):
    risk = RiskAnalysis(status="completed", message="분석 완료", assessment=RiskAssessment(
        level="moderate", label="보통", summary="추가 확인이 필요합니다.", reasons=["가격 시세: 시세보다 지나치게 저렴"]))
    return AnalysisQuestion(question=text, product=product(price="129000"), risk_analysis=risk,
                            seller_verification=SellerVerification(status="active", label="계속사업자", message="정상 사업자"))


class QuestionTests(unittest.TestCase):
    def test_evidence_starts_with_the_verdict(self):
        items = evidence(question())
        self.assertTrue(items[0].startswith("주의 수준: 보통"))
        self.assertTrue(any(item.startswith("판매자 사업자 확인: 계속사업자") for item in items))

    @patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"})
    @patch("question_answer.OpenAI")
    def test_citations_of_missing_evidence_are_dropped(self, client):
        client.return_value.chat.completions.create.return_value = completion(
            {"answer": "판매자는 정상 사업자로 조회돼요.", "cited": ["e2", "E2", "E99", "X"]})
        result = answer_question(question("판매자 믿을 만해?"))
        self.assertEqual(result.status, "answered")
        self.assertEqual([citation.id for citation in result.citations], ["E2"])
        prompt = client.return_value.chat.completions.create.call_args.kwargs["messages"][1]["content"]
        self.assertIn("E1. 주의 수준: 보통", prompt)

    @patch.dict(os.environ, {"OPENAI_API_KEY": ""})
    def test_without_a_key_nothing_is_made_up(self):
        self.assertEqual(answer_question(question()).status, "unavailable")

    def test_endpoint_rejects_an_empty_question(self):
        payload = json.loads(question().model_dump_json())
        payload["question"] = ""
        self.assertEqual(TestClient(main.app).post("/analysis-questions", json=payload).status_code, 422)


from datetime import date  # noqa: E402

from claims_check import check_claims  # noqa: E402
from market_price import discount_notes  # noqa: E402
from risk_analysis import review_checks  # noqa: E402
from schemas import ListingClaim, ListingMark, OfferDetails  # noqa: E402

PAGE = "삼성전자 갤럭시 버즈3 프로\n100% 정품 보장\n삼성전자 공식 인증 판매점\n정식 수입품입니다"


def samsung(offer, condition="new"):
    return ProductDetails(brand_name="삼성전자", product_name="갤럭시 버즈3 프로", model_number="SM-R630", price="219000",
                          currency="KRW", seller_name="스토어", components=["이어버드"], condition=condition, offer=offer)


def seller(name, status="active"):
    return SellerVerification(status=status, label="계속사업자", message="정상", seller={"business_name": name})


class ClaimTests(unittest.TestCase):
    def test_a_mark_earns_credit_only_when_the_seller_is_the_brand(self):
        offer = OfferDetails(marks=[ListingMark(name="삼성전자 공식 인증 마크", source="image")],
                             claims=[ListingClaim(kind="official_seller", quote="삼성전자 공식 인증 판매점")])
        own = check_claims(samsung(offer), seller("삼성전자(주)"), PAGE)
        self.assertEqual(own.status, "confirmed")
        other = check_claims(samsung(offer), seller("버즈마트"), PAGE)
        self.assertEqual(other.status, "unverified")
        self.assertIn("점수에 넣지 않았습니다", other.message)
        criteria = assess_risk(analyzed(), None, seller("삼성전자(주)"), MarketPrice(status="no_model"), claims=own).criteria
        self.assertEqual([item.status for item in criteria if item.key == "claims"], ["confirmed"])
        unscored = assess_risk(analyzed(), None, seller("버즈마트"), MarketPrice(status="no_model"), claims=other)
        self.assertFalse(any(item.key == "claims" for item in unscored.criteria))

    def test_official_import_that_is_also_a_parallel_import_is_a_finding(self):
        offer = OfferDetails(claims=[ListingClaim(kind="official_import", quote="정식 수입품입니다")])
        result = check_claims(samsung(offer, condition="parallel_import"), seller("버즈마트"), PAGE)
        self.assertEqual(result.status, "contradicted")
        verdict = assess_risk(analyzed(), None, seller("버즈마트"), MarketPrice(status="no_model"), claims=result)
        self.assertEqual(verdict.level, "moderate")
        self.assertIn("정품·공식 주장과 맞지 않는 정보", verdict.reasons)

    def test_a_reworded_claim_is_dropped(self):
        offer = OfferDetails(claims=[ListingClaim(kind="genuine", quote="무조건 정품만 팝니다")])
        self.assertIsNone(check_claims(samsung(offer), seller("버즈마트"), PAGE))

    def test_genuine_claim_far_below_the_market_is_a_finding(self):
        offer = OfferDetails(claims=[ListingClaim(kind="genuine", quote="100% 정품 보장")])
        market = MarketPrice(status="far_below", ratio_percent=30)
        self.assertEqual(check_claims(samsung(offer), seller("버즈마트"), PAGE, market).status, "contradicted")


class DiscountTests(unittest.TestCase):
    market = MarketPrice(status="typical", median_price="400000")

    def test_a_list_price_far_above_the_market_is_inflated(self):
        notes = discount_notes(product(price="389000").model_copy(update={"offer": OfferDetails(list_price="999000")}),
                               self.market, date(2026, 11, 4))
        self.assertTrue(notes["list_inflated"])
        verdict = assess_risk(analyzed(), None, seller("스토어"), self.market.model_copy(update=notes))
        self.assertEqual([item.status for item in verdict.criteria if item.key == "price"], ["attention"])

    def test_deadlines(self):
        passed = discount_notes(product().model_copy(update={"offer": OfferDetails(discount_ends="11-01", discount_percent=30)}),
                                self.market, date(2026, 11, 4))
        self.assertIn("이미 지났는데도", passed["discount_note"])
        soon = discount_notes(product().model_copy(update={"offer": OfferDetails(discount_ends="2026-11-05", discount_percent=70)}),
                              self.market, date(2026, 11, 4))
        self.assertIn("70% 할인", soon["discount_note"])
        far = discount_notes(product().model_copy(update={"offer": OfferDetails(discount_ends="2026-12-31", discount_percent=70)}),
                             self.market, date(2026, 11, 4))
        self.assertEqual(far, {})

    def test_the_headline_price_is_the_bait_even_when_the_sale_price_is_an_option(self):
        listing = product(price="389000", options=[ProductOption(name="케이스", price="9900", kind="addon"),
                                                   ProductOption(name="헤드폰", price="389000")])
        self.assertIsNone(option_bait(listing))
        listing.offer = OfferDetails(display_price="9900")
        self.assertEqual(option_bait(listing)[0], 389000)

    def test_extraction_reads_the_offer(self):
        parsed = _normalize_product({"offer": {"display_price": "9,900원", "list_price": "599,000", "discount_percent": "98%",
                                               "discount_ends": "11-10", "claims": [{"kind": "genuine", "quote": "100% 정품"},
                                                                                     {"kind": "best", "quote": "최고"}],
                                               "marks": [{"name": "공식 인증점", "source": "image"}]}})
        self.assertEqual((parsed.offer.display_price, parsed.offer.list_price, parsed.offer.discount_percent,
                          parsed.offer.discount_ends), ("9900", "599000", 98, "11-10"))
        self.assertEqual([claim.kind for claim in parsed.offer.claims], ["genuine"])
        self.assertEqual(parsed.offer.marks[0].source, "image")


class ReviewRuleTests(unittest.TestCase):
    def test_rewards_for_five_stars_count_but_platform_review_points_do_not(self):
        ids = {check.id for check in review_checks("포토 리뷰 작성 시 네이버페이 포인트 최대 500원 적립\n별점 5점 리뷰 남겨주시면 사은품 증정!")}
        self.assertIn("review_rated_reward", ids)
        self.assertNotIn("review_rated_reward", {check.id for check in review_checks("리뷰 작성 시 포인트 적립")})

    def test_many_sponsored_reviews(self):
        text = "\n".join(f"업체로부터 제품을 무상으로 제공받아 작성한 후기입니다 {index}" for index in range(3))
        self.assertIn("review_sponsored", {check.id for check in review_checks(text)})
        self.assertNotIn("review_sponsored", {check.id for check in review_checks(text.splitlines()[0])})

    def test_reviews_bunched_into_a_few_days(self):
        burst = "\n".join(["2026.11.01"] * 6 + ["2026.11.02"] * 5 + ["2026.08.10"])
        self.assertIn("review_burst", {check.id for check in review_checks(burst)})
        spread = "\n".join(f"2026.{month:02d}.15" for month in range(1, 13))
        self.assertNotIn("review_burst", {check.id for check in review_checks(spread)})
