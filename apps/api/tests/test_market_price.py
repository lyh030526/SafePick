import os
import unittest
from unittest.mock import MagicMock, patch

import httpx

from market_price import check_market_price
from schemas import ProductDetails


def product(model="WH-1000XM5", price="129,000", currency="KRW", name="노이즈캔슬링 헤드폰"):
    return ProductDetails(brand_name="소니", product_name=name, model_number=model, price=price,
                          currency=currency, seller_name="테스트스토어", components=["헤드폰"])


def shopping(*offers):
    response = MagicMock()
    response.json.return_value = {"shopping": [
        {"title": title, "source": source, "price": price, "link": f"https://shop.example/{index}", "productId": str(index)}
        for index, (title, source, price) in enumerate(offers)]}
    return response


MARKET = [("소니 WH-1000XM5 블랙", "G마켓", "₩400,000"), ("Sony WH 1000XM5 실버", "11번가", "₩420,000"),
          ("[소니코리아] WH-1000XM5", "컴퓨존", "₩380,000"), ("소니 WH-1000XM5 헤드폰", "롯데ON", "₩410,000")]


@patch.dict(os.environ, {"SERPER_API_KEY": "test-key"})
class MarketPriceTests(unittest.TestCase):
    def test_requires_a_model_number(self):
        for model in ["확인 불가", "헤드폰", "X1"]:
            with self.subTest(model=model):
                self.assertEqual(check_market_price(product(model=model)).status, "no_model")

    def test_missing_key_and_foreign_currency_are_unavailable(self):
        with patch.dict(os.environ, {"SERPER_API_KEY": ""}):
            self.assertEqual(check_market_price(product()).status, "unavailable")
        self.assertEqual(check_market_price(product(currency="USD")).status, "unavailable")

    @patch("market_price.httpx.post")
    def test_thresholds_against_the_median(self, post):
        post.return_value = shopping(*MARKET)
        for price, status, ratio in [("202,000", "far_below", 49), ("202,500", "below", 50),
                                     ("283,000", "below", 69), ("283,500", "typical", 70), ("520,000", "typical", 128)]:
            with self.subTest(price=price):
                result = check_market_price(product(price=price))
                self.assertEqual((result.status, result.ratio_percent), (status, ratio))
        self.assertEqual((result.median_price, result.min_price, result.max_price, result.match_count),
                         ("405000", "380000", "420000", 4))
        self.assertEqual([item.price for item in result.listings], ["380000", "400000", "410000"])
        self.assertEqual(post.call_args.kwargs["json"]["q"], "소니 WH-1000XM5")

    @patch("market_price.httpx.post")
    def test_excludes_other_models_used_accessories_and_outliers(self, post):
        post.return_value = shopping(
            *MARKET[:3],
            ("소니 WH-1000XM4", "G마켓", "₩250,000"),                 # previous model
            ("WH-1000XM50 신형", "G마켓", "₩900,000"),                # longer model number
            ("소니 WH-1000XM5 중고 A급", "G마켓", "₩150,000"),          # used
            ("소니 WH-1000XM5", "후루츠패밀리", "₩190,000"),            # second-hand marketplace
            ("WH-1000XM5 하드 케이스", "쿠팡", "₩19,000"),              # accessory
            ("소니 WH-1000XM5 월 렌탈", "렌탈샵", "₩12,900"),          # rental
            ("소니 WH-1000XM5 일시불", "어딘가몰", "₩9,900"),           # outlier past the filters
            ("Sony WH-1000XM5", "Amazon", "$398.00"),               # foreign currency
        )
        result = check_market_price(product(price="400,000"))
        self.assertEqual(result.match_count, 3)
        self.assertEqual(result.median_price, "400000")

    @patch("market_price.httpx.post")
    def test_own_category_word_does_not_exclude_matches(self, post):
        post.return_value = shopping(*[(f"WH-1000XM5 전용 케이스 {i}", "몰", "₩20,000") for i in range(3)])
        self.assertEqual(check_market_price(product(price="19,000", name="WH-1000XM5 전용 케이스")).status, "typical")

    @patch("market_price.httpx.post")
    def test_accessory_is_compared_only_with_the_same_accessory(self, post):
        pads = [(f"WH-1000XM5 호환 교체용 이어패드 {i}", "몰", "₩24,000") for i in range(3)]
        post.return_value = shopping(*MARKET, *pads)
        result = check_market_price(product(price="25,350", name="소니호환 WH-1000XM5 교체용 이어패드"))
        self.assertEqual((result.status, result.match_count, result.median_price), ("typical", 3, "24000"))
        post.return_value = shopping(*MARKET)
        self.assertEqual(check_market_price(product(price="25,350", name="WH-1000XM5 교체용 이어패드")).status,
                         "insufficient")

    @patch("market_price.httpx.post")
    def test_too_few_matches_or_no_price_withhold_judgement(self, post):
        post.return_value = shopping()
        self.assertEqual(check_market_price(product()).status, "insufficient")
        post.return_value = shopping(*MARKET)
        result = check_market_price(product(price="확인 불가"))
        self.assertEqual((result.status, result.median_price, result.ratio_percent), ("no_price", "405000", None))

    @patch("market_price.httpx.post")
    def test_one_or_two_shops_are_a_reference_that_is_not_judged(self, post):
        post.return_value = shopping(*MARKET[:2])
        result = check_market_price(product(price="150,000"))
        self.assertEqual((result.status, result.label, result.match_count, result.ratio_percent), ("reference", "참고 가격", 2, None))
        self.assertEqual(result.median_price, "410000")
        self.assertIn("점수에는 넣지 않았습니다", result.message)

    @patch("market_price.httpx.post")
    def test_a_short_code_counts_only_with_the_brand_in_the_title(self, post):
        post.return_value = shopping(("사운독스 Y-07 노이즈캔슬링 이어폰", "G마켓", "₩39,000"),
                                     ("사운독스 Y07 블루투스 이어폰", "11번가", "₩41,000"),
                                     ("SOUNDOX 사운독스 Y 07", "옥션", "₩40,000"),
                                     ("Y-07 이어폰 무선", "어딘가몰", "₩9,000"))  # no brand: another maker's Y-07
        item = ProductDetails(brand_name="사운독스", product_name="노이즈 캔슬링 이어폰", model_number="Y-07", price="38,000",
                              currency="KRW", seller_name="사운독스", components=["이어폰"])
        result = check_market_price(item)
        self.assertEqual((result.status, result.match_count, result.median_price), ("typical", 3, "40000"))
        self.assertEqual(check_market_price(item.model_copy(update={"brand_name": "확인 불가"})).status, "no_model")

    @patch("market_price.httpx.post", side_effect=httpx.ConnectTimeout("timeout"))
    def test_network_failure_is_unavailable(self, _post):
        self.assertEqual(check_market_price(product()).status, "unavailable")


if __name__ == "__main__":
    unittest.main()


class NameFallbackTests(unittest.TestCase):
    def test_a_named_product_is_found_when_shops_leave_the_model_code_out(self):
        from market_price import _name_pattern
        matches, query, numbered = _name_pattern("레드미 버즈 6 플레이", "샤오미")
        self.assertEqual((query, numbered), ("레드미 버즈 6 플레이", True))
        self.assertTrue(matches("샤오미 레드미 버즈6 플레이 블루투스 이어폰"))
        self.assertFalse(matches("샤오미 레드미 버즈6 라이트 블루투스 이어폰"))  # another tier
        self.assertFalse(matches("샤오미 레드미 버즈 7 플레이"))  # another number
        self.assertFalse(matches("레드미 버즈 6 플레이 호환"))  # no brand
        # Generic or brandless names are not compared at all.
        self.assertIsNone(_name_pattern("무선 블루투스 이어폰", "TECNONEXO")[0])
        self.assertIsNone(_name_pattern("갤럭시 버즈3 프로", "")[0])

    def test_a_name_without_numbers_needs_every_word_and_the_brand(self):
        from market_price import _name_pattern
        matches, query, numbered = _name_pattern("다이슨 에어랩 i.d 멀티 스타일러 앤 드라이어", "다이슨")
        self.assertEqual((query, numbered), ("다이슨 에어랩 멀티 스타일러 드라이어", False))
        self.assertTrue(matches("[국내정품] 다이슨 에어랩 i.d 멀티 스타일러 앤 드라이어 블루"))
        self.assertFalse(matches("다이슨 에어랩 멀티 스타일러 블루"))  # a word missing
        self.assertFalse(matches("에어랩 멀티 스타일러 드라이어 호환"))  # no brand
        self.assertIsNone(_name_pattern("다이슨 에어랩", "다이슨")[0])  # too few words besides the brand


@patch.dict(os.environ, {"SERPER_API_KEY": "test-key"})
class NameOnlyMarketTests(unittest.TestCase):
    def item(self, price):
        return ProductDetails(brand_name="캘빈클라인", product_name="캘빈클라인 CK 이터너티 포 맨 EDT", model_number="확인 불가",
                              price=price, currency="KRW", seller_name="향수가게", components=["향수"])

    @patch("market_price.httpx.post")
    def test_a_numberless_name_is_judged_when_prices_agree(self, post):
        post.return_value = shopping(*[(f"캘빈클라인 CK 이터너티 포 맨 EDT {i}", "몰", price)
                                       for i, price in enumerate(["₩52,000", "₩55,000", "₩58,000"])])
        self.assertEqual(check_market_price(self.item("54,000")).status, "typical")

    @patch("market_price.httpx.post")
    def test_a_wide_spread_from_a_numberless_name_is_only_a_reference(self, post):
        # 30ml and 100ml bottles under the same name: a cheap price against them is not a finding.
        post.return_value = shopping(*[(f"캘빈클라인 CK 이터너티 포 맨 EDT {i}", "몰", price)
                                       for i, price in enumerate(["₩35,000", "₩60,000", "₩89,000"])])
        result = check_market_price(self.item("20,000"))
        self.assertEqual(result.status, "reference")
        self.assertIn("용량·구성이 다를 수 있어", result.message)
