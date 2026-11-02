"""Rules for marketplace listings from ordinary sellers (Coupang): image-only components, new sellers, and reviews."""
import unittest
from datetime import date

from risk_analysis import DetailsDraft, RiskDraft, review_checks, validate_risk_draft
from risk_assessment import assess_risk
from schemas import DomainCheck, MailOrderCheck, MarketPrice, SellerVerification

TODAY = date(2026, 11, 1)
MARKETPLACE = DomainCheck(status="marketplace", label="오픈마켓", domain="coupang.com")
RETURNS = "교환/반품 제한사항: 구성품 누락으로 상품의 가치가 현저히 감소된 경우 반품 불가"


def listing(extra=""):
    text = (f"무선 블루투스 이어폰 LX-96은 블루투스 5.4로 끊김 없이 연결됩니다.\n배송비 무료, 1-2일 이내 도착\n"
            f"수령 후 30일 이내 반품 가능\n{extra}")
    details = {key: [] for key in DetailsDraft.model_fields}
    details.update(description=["무선 블루투스 이어폰 LX-96은 블루투스 5.4로 끊김 없이 연결됩니다."],
                   shipping=["배송비 무료, 1-2일 이내 도착"], returns=["수령 후 30일 이내 반품 가능"])
    return validate_risk_draft(RiskDraft(details=DetailsDraft(**details), signals=[]), text)


def seller(report="2019-서울강남-01234"):
    return SellerVerification(status="active", label="계속사업자", mail_order=MailOrderCheck(
        status="matched", label="통신판매업 신고 일치", report_number=report))


class ComponentTests(unittest.TestCase):
    def test_a_return_policy_mentioning_components_does_not_ask_for_them(self):
        self.assertNotIn("missing_components", [item.id for item in listing(RETURNS).checklist])

    def test_marketplace_listings_are_not_held_back_by_image_only_components(self):
        analysis = listing("구성품: 상세 이미지 참조")
        self.assertIn("missing_components", [item.id for item in analysis.checklist])
        own_mall = assess_risk(analysis, None, seller(), today=TODAY)
        self.assertEqual((own_mall.level, own_mall.missing_checks), ("undetermined", ["구성품 확인 필요"]))
        coupang = assess_risk(analysis, None, seller(), domain=MARKETPLACE, today=TODAY)
        self.assertEqual((coupang.level, coupang.missing_checks), ("low", []))
        self.assertEqual(next(item.status for item in coupang.criteria if item.key == "purchase_terms"), "confirmed")


class MarketplaceReturnsTests(unittest.TestCase):
    def test_marketplaces_run_returns_themselves(self):
        text = "무선 블루투스 이어폰 LX-96은 블루투스 5.4로 끊김 없이 연결됩니다.\n배송비 무료, 1-2일 이내 도착"
        details = {key: [] for key in DetailsDraft.model_fields}
        details.update(description=["무선 블루투스 이어폰 LX-96은 블루투스 5.4로 끊김 없이 연결됩니다."], shipping=["배송비 무료, 1-2일 이내 도착"])
        analysis = validate_risk_draft(RiskDraft(details=DetailsDraft(**details), signals=[]), text)
        coupang = assess_risk(analysis, None, seller(), domain=MARKETPLACE, today=TODAY)
        self.assertEqual((coupang.level, coupang.missing_checks), ("low", []))
        own = assess_risk(analysis, None, seller(), domain=DomainCheck(status="established"), today=TODAY)
        self.assertIn("반품·교환 조건", own.missing_checks)


class NewSellerTests(unittest.TestCase):
    def test_a_report_filed_this_year_holds_the_level_back(self):
        fresh = assess_risk(listing(), None, seller("2026-용인처인-01238"), domain=MARKETPLACE, today=TODAY)
        self.assertEqual((fresh.level, fresh.missing_checks), ("undetermined", ["판매자 운영 기간"]))
        self.assertIn("신규 판매자", fresh.summary)
        self.assertIn("통신판매업 신고: 2026년 신고 (2026-용인처인-01238)", fresh.reasons)
        self.assertIn("2026년에 통신판매업을 신고한 신규 판매자", next(item.detail for item in fresh.criteria if item.key == "seller"))
        self.assertEqual(assess_risk(listing(), None, seller("제2025-서울-0001호"), domain=MARKETPLACE, today=TODAY).level, "low")
        # The page's own number counts when the FTC record is not available.
        page_only = SellerVerification(status="active", label="계속사업자")
        page_only.seller.mail_order_number = "2026-서울강남-00001"
        self.assertIn("판매자 운영 기간", assess_risk(listing(), None, page_only, today=TODAY).missing_checks)


class ReviewTests(unittest.TestCase):
    def test_chatbot_leftovers_in_reviews_are_flagged(self):
        leftover = "다음 제품 리뷰 작성을 도와드릴까요? 원하시는 제품명이나 강조하고 싶은 특징을 알려주세요!"
        checks = review_checks(f"상품 리뷰\n음질이 좋아요\n{leftover}")
        self.assertEqual([(item.id, item.kind, item.quotes) for item in checks], [("review_ai_leftover", "attention", [leftover])])
        result = assess_risk(listing(leftover), None, seller(), domain=MARKETPLACE, today=TODAY)
        self.assertEqual(result.level, "moderate")
        self.assertIn("AI로 작성한 흔적이 있는 리뷰", result.reasons)
        self.assertIn("리뷰가 실제 구매 후기가 아닐 수 있는", result.summary)
        self.assertEqual(review_checks("상품 리뷰\n음질이 좋아요\n배송이 빨라요"), [])

    def test_the_same_sentence_in_three_reviews_is_a_template(self):
        line = "가성비 최고의 이어폰으로 출퇴근길에 강력 추천합니다!"
        self.assertEqual([item.id for item in review_checks("\n".join([line, "좋아요", line, line]))], ["review_copied"])
        # Seller tables and product names repeat by design.
        title = "TECNONEXO 무선 블루투스 이어폰 커널형 블루투스 5.4 Hi-Fi 고음질 저지연, 화이트, LX-96"
        self.assertEqual(review_checks("\n".join([title] * 4 + ["판매자: 리샤무역 유한회사 상품을 구매했습니다."] * 3)), [])


class OwnMallTests(unittest.TestCase):
    def test_a_new_shop_without_business_information_is_a_signal(self):
        missing = SellerVerification()
        new = DomainCheck(status="new", label="신규 도메인", registered_on="2026-04-01")
        result = assess_risk(listing(), None, missing, domain=new, today=TODAY)
        self.assertEqual(result.level, "moderate")
        self.assertIn("사업자 정보를 표시하지 않은 신규 쇼핑몰", result.reasons)
        self.assertIn("사업자 정보가 보이지 않고", result.summary)
        # An old mall may load its footer with scripts; that alone is not judged.
        old = DomainCheck(status="established", label="오래된 도메인")
        self.assertEqual(assess_risk(listing(), None, missing, domain=old, today=TODAY).level, "undetermined")

    def test_aladin_writes_the_number_without_beon_ho(self):
        from seller_verification import extract_seller_info
        seller = extract_seller_info("(주)알라딘커뮤니케이션 대표이사 최우경 사업자등록 201-81-23094 통신판매업신고 2003-서울중구-01520")
        self.assertEqual((seller.business_number, seller.mail_order_number), ("201-81-23094", "2003-서울중구-01520"))


class PlatformNoticeTests(unittest.TestCase):
    def test_coupang_standard_return_text_is_not_the_sellers_ambiguous_condition(self):
        for boilerplate in ["ㆍ교환/반품에 관한 일반적인 사항은 판매자가 제시사항보다 관계법령이 우선합니다.",
                            "세트상품 일부 사용, 구성품을 분실하였거나 취급 부주의로 인한 파손/고장/오염으로 재판매 불가한 경우"]:
            draft = RiskDraft(details=DetailsDraft(description=[], components=[], options=[], shipping=[], returns=[], warranty=[]),
                              signals=[{"category": "ambiguous_conditions", "quotes": [boilerplate]}])
            self.assertEqual([item for item in validate_risk_draft(draft, boilerplate).checklist if item.kind == "attention"], [])


class ScoreTests(unittest.TestCase):
    def test_unbranded_listings_are_scored_on_the_seller_and_listing(self):
        result = assess_risk(listing(), None, seller(), MarketPrice(status="insufficient"), domain=MARKETPLACE, today=TODAY)
        self.assertEqual([item.key for item in result.criteria], ["description", "purchase_terms", "seller", "history"])
        self.assertEqual((result.level, result.coverage_percent), ("low", 100))

    def test_the_sellers_track_record_spreads_low_scores(self):
        # 85 points of other evidence confirmed; the record's 25 earn 1.0, 0.75 or 0.5 inside the 80-95 band.
        scores = {}
        for report, status in [("2019-서울강남-01234", "confirmed"), ("2024-경기김포-6407", "partial"),
                               ("2025-경기김포-9181", "unknown")]:
            result = assess_risk(listing(), None, seller(report), domain=MARKETPLACE, today=TODAY)
            history = next(item for item in result.criteria if item.key == "history")
            self.assertEqual((result.level, history.status), ("low", status))
            scores[report[:4]] = result.score
        self.assertEqual(scores, {"2019": 95, "2024": 93, "2025": 92})
        new = assess_risk(listing(), None, seller("2026-서울금천-1600"), domain=MARKETPLACE, today=TODAY)
        self.assertIn("운영 이력이 거의 없어", next(item.detail for item in new.criteria if item.key == "history"))

    def test_an_official_match_or_market_price_lifts_the_ceiling(self):
        typical = MarketPrice(status="typical", label="시세 범위", ratio_percent=95)
        self.assertEqual(assess_risk(listing(), None, seller(), typical, domain=MARKETPLACE, today=TODAY).score, 100)


if __name__ == "__main__":
    unittest.main()
