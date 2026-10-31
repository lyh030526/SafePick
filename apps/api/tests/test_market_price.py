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
        post.return_value = shopping(*MARKET[:2])
        self.assertEqual(check_market_price(product()).status, "insufficient")
        post.return_value = shopping(*MARKET)
        result = check_market_price(product(price="확인 불가"))
        self.assertEqual((result.status, result.median_price, result.ratio_percent), ("no_price", "405000", None))

    @patch("market_price.httpx.post", side_effect=httpx.ConnectTimeout("timeout"))
    def test_network_failure_is_unavailable(self, _post):
        self.assertEqual(check_market_price(product()).status, "unavailable")


if __name__ == "__main__":
    unittest.main()
