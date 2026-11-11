import os
import unittest
from unittest.mock import MagicMock, patch

from extractor import _normalize_product
from maker_check import check_maker
from official_discovery import discover_official_brand
from schemas import ProductDetails, ProductNotice


def search(organic=(), graph=None):
    response = MagicMock()
    response.json.return_value = {"organic": [dict(title=t, link=l, snippet=s) for t, l, s in organic],
                                  **({"knowledgeGraph": graph} if graph else {})}
    return response


@patch.dict(os.environ, {"SERPER_API_KEY": "test-key"})
class DiscoveryTests(unittest.TestCase):
    @patch("official_discovery.httpx.post")
    def test_knowledge_panel_website_is_the_official_site(self, post):
        post.return_value = search(graph={"title": "이니스프리", "website": "https://www.innisfree.com/kr/ko/"})
        brand = discover_official_brand("이니스프리", "https://www.innisfree.com/kr/ko/product/1")
        self.assertEqual(brand.domains, ("innisfree.com",))

    @patch("official_discovery.httpx.post")
    def test_a_top_result_must_carry_the_brand_and_say_it_is_official(self, post):
        post.return_value = search(organic=[
            ("사운독스 - 쿠팡!", "https://www.coupang.com/np/search?q=사운독스", "사운독스 공식"),     # marketplace
            ("사운독스 이어폰 후기", "https://blog.example.com/1", "좋아요"),                          # no official word
            ("사운독스 공식 홈페이지", "https://www.soundox.co.kr/", "블루투스 이어폰 전문 브랜드"),
        ])
        self.assertEqual(discover_official_brand("사운독스").domains, ("soundox.co.kr",))

    @patch("official_discovery.httpx.post")
    def test_the_shop_itself_cannot_vouch_for_itself_from_a_result(self, post):
        post.return_value = search(organic=[("brandx 공식 스토어", "https://www.brandx.com/", "공식")])
        self.assertIsNone(discover_official_brand("brandx", "https://www.brandx.com/products/1"))
        self.assertEqual(discover_official_brand("brandx", "https://other.example/p").domains, ("brandx.com",))

    @patch("official_discovery.httpx.post")
    def test_a_reported_scam_domain_is_never_official(self, post):
        post.return_value = search(organic=[("blakiey 공식 스토어", "https://www.blakiey.com/", "공식")])
        self.assertIsNone(discover_official_brand("blakiey", "https://other.example/p"))

    @patch("official_discovery.httpx.post")
    def test_lookalike_or_unknown_brands_find_nothing(self, post):
        post.return_value = search(organic=[("나이키 공식 아울렛", "https://nike-outlet-kr.shop/", "공식")])
        self.assertIsNone(discover_official_brand("나이키코리아아울렛"))
        self.assertIsNone(discover_official_brand("확인 불가"))
        post.assert_called_once()

    @patch("official_discovery.httpx.post")
    def test_brands_already_known_for_lookalikes_need_no_search(self, post):
        self.assertEqual(discover_official_brand("Nike").domains, ("nike.com",))
        post.assert_not_called()


def product(maker="확인 불가", importer="확인 불가", kc=(), seller="사운독스"):
    return ProductDetails(brand_name="사운독스", product_name="이어폰", model_number="Y-07", price="39000", currency="KRW",
                          seller_name=seller, components=["이어폰"],
                          notice=ProductNotice(maker=maker, importer=importer, kc_numbers=list(kc)))


class MakerTests(unittest.TestCase):
    def test_seller_who_is_the_maker(self):
        result = check_maker(product(maker="(주)사운독스", kc=["R-R-SDX-Y07"]), None)
        self.assertEqual(result.status, "seller_is_maker")
        self.assertIn("국립전파연구원", result.message)
        self.assertIn("rra.go.kr", result.kc_link)

    def test_the_brands_korean_company_counts_as_the_maker(self):
        item = product(maker="SHOKZ", seller="샥즈코리아 주식회사").model_copy(update={"brand_name": "샥즈"})
        self.assertEqual(check_maker(item, None).status, "seller_is_maker")

    def test_a_reseller_and_a_pointer_to_the_detail_page(self):
        self.assertEqual(check_maker(product(maker="NIKE INC.", importer="(유)나이키코리아", seller="스포츠몰"), None).status,
                         "listed")
        self.assertEqual(check_maker(product(maker="상품 상세페이지 참조", seller="스포츠몰"), None).status, "see_detail")
        self.assertEqual(check_maker(product(seller="스포츠몰"), None).status, "missing")

    def test_extraction_splits_the_notice_and_drops_non_numbers(self):
        item = _normalize_product({"brand_name": "JBL", "notice": {"maker": "JBL", "importer": "삼성전자", "origin": "중국",
                                                                   "kc_numbers": ["R-R-HAR-WBEAM2", "상품 상세페이지 참조"]}})
        self.assertEqual((item.notice.maker, item.notice.importer, item.notice.origin, item.notice.kc_numbers),
                         ("JBL", "삼성전자", "중국", ["R-R-HAR-WBEAM2"]))
        self.assertEqual(_normalize_product({}).notice.maker, "확인 불가")


if __name__ == "__main__":
    unittest.main()
