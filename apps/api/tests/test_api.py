import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
from extractor import _normalize_product, unknown_product
from official_brands import find_official_brand
from official_search import is_official_url
from scraper import ProductPage, ProductPageError, _extract_visible_text, fetch_product_page


class ScraperTests(unittest.TestCase):
    def test_supported_brand_matches_alias_and_official_subdomain(self):
        apple = find_official_brand("애플")

        self.assertIsNotNone(apple)
        self.assertEqual(apple.name, "Apple")
        self.assertTrue(is_official_url("https://www.apple.com/kr/airpods/", apple.domains))
        self.assertFalse(is_official_url("https://apple.example.com/airpods", apple.domains))

    def test_private_address_is_rejected(self):
        with self.assertRaises(ProductPageError):
            fetch_product_page("http://127.0.0.1:8000/internal")

    def test_visible_text_excludes_scripts(self):
        title, text = _extract_visible_text(
            "<html><title>상품</title><body><script>secret()</script><h1>AirPods</h1><p>359,000원</p></body></html>"
        )

        self.assertEqual(title, "상품")
        self.assertIn("AirPods", text)
        self.assertNotIn("secret", text)

    def test_normalizes_korean_or_short_llm_keys(self):
        product = _normalize_product(
            {
                "brand": "Apple",
                "상품명": "AirPods Pro 3",
                "model": "확인 불가",
                "가격": "369,000",
                "통화": "KRW",
                "seller": "Apple",
                "구성품": ["USB-C 충전 케이스"],
            }
        )

        self.assertEqual(product.brand_name, "Apple")
        self.assertEqual(product.product_name, "AirPods Pro 3")
        self.assertEqual(product.components, ["USB-C 충전 케이스"])


class AnalysisApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)

    @patch.dict(os.environ, {}, clear=True)
    @patch("main.fetch_product_page")
    def test_missing_key_returns_manual_input_fields(self, mocked_fetch):
        mocked_fetch.return_value = ProductPage(
            final_url="https://shop.example.com/product",
            title="테스트 상품",
            text="테스트 상품 설명",
        )

        response = self.client.post(
            "/analyses",
            json={"product_url": "https://shop.example.com/product"},
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "manual_input_required")
        self.assertEqual(body["product"], unknown_product().model_dump())
        self.assertTrue(body["warnings"])

    @patch("main.fetch_product_page")
    def test_blocked_shop_page_falls_back_to_manual_input(self, mocked_fetch):
        mocked_fetch.side_effect = ProductPageError("상품 페이지를 가져오지 못했습니다. (403)")

        response = self.client.post(
            "/analyses",
            json={"product_url": "https://shop.example.com/product"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "manual_input_required")

    @patch("main.fetch_product_page")
    def test_private_address_remains_rejected(self, mocked_fetch):
        mocked_fetch.side_effect = ProductPageError("공개 인터넷 주소만 분석할 수 있습니다.", fallback_allowed=False)

        response = self.client.post(
            "/analyses",
            json={"product_url": "https://shop.example.com/product"},
        )

        self.assertEqual(response.status_code, 422)

    def test_brands_endpoint_returns_initial_brands(self):
        response = self.client.get("/brands")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 5)
        self.assertEqual(response.json()[1]["name"], "Apple")


if __name__ == "__main__":
    unittest.main()
