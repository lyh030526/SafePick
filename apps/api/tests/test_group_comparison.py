"""Several listings of one product: seller kinds, the marketplace rating, and the group's own price reference."""
import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
from group_comparison import compare_group, group_market
from risk_assessment import assess_risk
from schemas import (AnalysisResponse, DomainCheck, MailOrderCheck, OfficialLookup, ProductDetails, SellerInfo,
                     SellerVerification, SourceSummary)
from seller_verification import verify_seller
from test_marketplace_rules import MARKETPLACE, TODAY, listing

COUPANG = "https://www.coupang.com/vp/products/1"


def active(name, report="2019-서울강남-01234"):
    return SellerVerification(status="active", label="계속사업자", seller=SellerInfo(business_name=name),
                              mail_order=MailOrderCheck(status="matched", report_number=report))


def response(seller, price, model="M2420E1"):
    analysis = listing()
    product = ProductDetails(brand_name="샤오미", product_name="레드미 버즈 6 플레이", model_number=model, price=str(price),
                             currency="KRW", seller_name=seller.seller.business_name, components=["확인 불가"])
    return AnalysisResponse(status="completed", product=product, warnings=[],
                            source=SourceSummary(page_title="레드미 버즈", final_url=COUPANG, text_length=100),
                            official_lookup=OfficialLookup(status="not_supported", message="미지원"),
                            risk_analysis=analysis.model_copy(update={"assessment": assess_risk(analysis, None, seller, domain=MARKETPLACE)}),
                            seller_verification=seller)


class SellerKindTests(unittest.TestCase):
    def test_coupang_selling_itself_is_a_confirmed_seller(self):
        rocket = "샤오미 레드미 버즈 6 플레이\n12,800원\n로켓배송\n상품 리뷰\n판매자: 쿠팡(주)\n음질 좋아요"
        result = verify_seller(rocket, COUPANG)
        self.assertEqual((result.status, result.label), ("platform_direct", "쿠팡 직접 판매"))
        assessed = assess_risk(listing(), None, result, domain=MARKETPLACE, today=TODAY)
        self.assertEqual((assessed.level, assessed.missing_checks), ("low", []))
        self.assertIn("쿠팡이 직접 판매하는 상품입니다.", assessed.reasons)
        # A marketplace seller named under the price is not Coupang, even when a review mentions a Rocket purchase.
        named = "12,900원\n판매자:\n리샤무역 유한회사\n판매자 상품 보러가기\n상품 리뷰\n판매자: 쿠팡(주)"
        self.assertNotEqual(verify_seller(named, COUPANG).status, "platform_direct")
        self.assertNotEqual(verify_seller(rocket, "https://smartstore.naver.com/a/products/1").status, "platform_direct")

    def test_overseas_sellers_are_named_as_such(self):
        for number in ["T4810050443459", "해당사항 없음"]:
            table = (f"판매자 정보:\n상호/대표자\nTAKE C / UCHIMURA TAKESHI\n사업장 소재지\nKagoshima shi, Japan Tagami 7-14-8\n"
                     f"통신판매업 신고번호\n사업자번호\n{number}")
            result = verify_seller(table, COUPANG)
            self.assertEqual((result.status, result.seller.business_name), ("overseas", "TAKE C"))
        assessed = assess_risk(listing(), None, result, domain=MARKETPLACE, today=TODAY)
        self.assertEqual((assessed.level, assessed.missing_checks), ("undetermined", ["해외 판매자 (국내 사업자 확인 불가)"]))
        self.assertIn("해외 판매자", assessed.summary)
        self.assertEqual(next(item.status for item in assessed.criteria if item.key == "seller"), "partial")

    @patch.dict(os.environ, {"DATA_GO_KR_SERVICE_KEY": ""})
    def test_a_low_marketplace_rating_is_a_signal(self):
        text = ("판매자:\nH&S\n판매자 상품 보러가기\n판매자 평가\n60%\n(\n15\n)\n판매자 정보:\n상호/대표자\nH&S / FUJII KAZUKI\n"
                "사업장 소재지\nOsaka, Japan\n사업자번호\nT6810794865468")
        seller = verify_seller(text, COUPANG)
        self.assertEqual((seller.status, seller.marketplace_rating, seller.rating_count), ("overseas", 60, 15))
        assessed = assess_risk(listing(), None, seller, domain=MARKETPLACE, today=TODAY)
        self.assertEqual(assessed.level, "moderate")
        self.assertIn("판매자 평가: 60% (15명)", assessed.reasons)
        few = seller.model_copy(update={"rating_count": 5})
        self.assertEqual(assess_risk(listing(), None, few, domain=MARKETPLACE, today=TODAY).level, "undetermined")


class GroupTests(unittest.TestCase):
    def test_the_other_pages_are_the_price_reference(self):
        market = group_market([12800, 25850, 28120, 29030], 0)
        self.assertEqual((market.status, market.ratio_percent, market.median_price, market.match_count),
                         ("far_below", 46, "28,120원", 3))
        self.assertIsNone(group_market([12800, 25850, None], 0))

    def test_listings_are_ranked_and_a_far_below_price_is_flagged(self):
        results = [response(active("싼곳"), 9900), response(active("오래된곳"), 26000), response(active("새곳", "2025-서울-1"), 25000),
                   response(active("다른모델"), 27000, model="BHR8776GL"), response(active("비싼곳"), 45000)]
        group = compare_group(results)
        ranked = [(item.seller_name, item.level, item.score) for item in group.listings]
        self.assertEqual(ranked[0][:2], ("오래된곳", "low"))
        cheap = next(item for item in group.listings if item.seller_name == "싼곳")
        self.assertEqual((cheap.level, cheap.price_percent), ("moderate", 37))  # 9,900 of the others' 26,500
        self.assertEqual(cheap.rank, 5)
        self.assertIn("시세보다 지나치게 저렴", cheap.analysis.market_price.label)
        other = next(item for item in group.listings if item.seller_name == "다른모델")
        self.assertIn("모델 표기(BHR8776GL)가 다른 판매 페이지 대부분(M2420E1)과 다릅니다", other.notes[0])
        self.assertIn("비쌉니다", next(item for item in group.listings if item.seller_name == "비싼곳").notes[0])
        self.assertEqual((group.median_price, group.model_number), (26000, "M2420E1"))
        self.assertIn("근거가 가장 많은 곳은 오래된곳", group.summary)

    def test_the_marketplaces_own_price_is_never_too_cheap(self):
        rocket = SellerVerification(status="platform_direct", label="쿠팡 직접 판매", seller=SellerInfo(business_name="쿠팡(주)"))
        results = [response(rocket, 12800), response(active("국내"), 18000), response(active("해외1"), 28000),
                   response(active("해외2"), 29000), response(active("이름표기"), 30000, model="Redmi Buds 6 Play")]
        group = {item.seller_name: item for item in compare_group(results).listings}
        self.assertEqual((group["쿠팡(주)"].level, group["쿠팡(주)"].rank), ("low", 1))
        self.assertEqual(group["국내"].analysis.market_price.label, "마켓 직접 판매가 수준")
        self.assertEqual(group["국내"].level, "low")
        self.assertEqual(group["이름표기"].notes, [])

    @patch("main.analyze_provided")
    def test_the_endpoint_needs_extension_captures(self, analyze):
        analyze.side_effect = [response(active("A"), 26000), response(active("B"), 25000)]
        client = TestClient(main.app)
        body = client.post("/group-analyses", json={"listings": [{"product_url": COUPANG, "provided_text": "설명 A"},
                                                                 {"product_url": COUPANG, "provided_text": "설명 B"}]})
        self.assertEqual((body.status_code, len(body.json()["listings"])), (200, 2))
        missing = client.post("/group-analyses", json={"listings": [{"product_url": COUPANG}, {"product_url": COUPANG}]})
        self.assertEqual(missing.status_code, 422)


if __name__ == "__main__":
    unittest.main()
