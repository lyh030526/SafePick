import os
import unittest
from unittest.mock import patch

from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

import main
from extractor import _normalize_product, unknown_product
from official_brands import find_official_brand
from official_search import is_official_url
from request_limits import AnalysisRateLimit, reset_rate_limits
from schemas import RiskAnalysis
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

    def test_long_pages_keep_the_footer_with_the_seller(self):
        footer = "상호 테스트몰 사업자등록번호 123-45-67891"
        _title, text = _extract_visible_text(f"<html><body><main>{'상품 설명 ' * 3000}</main><footer>{footer}</footer></body></html>")
        self.assertLessEqual(len(text), 12000)
        self.assertTrue(text.startswith("상품 설명"))
        self.assertTrue(text.endswith(footer))

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
        patcher = patch("main.analyze_listing_risks", return_value=RiskAnalysis())
        patcher.start()
        self.addCleanup(patcher.stop)

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

    def test_oversized_comparison_body_is_rejected(self):
        response = self.client.post("/comparisons", content=b"x" * (256 * 1024 + 1),
                                    headers={"content-type": "application/json"})
        self.assertEqual(response.status_code, 413)

    def test_rate_limit_rejects_excess_analysis_requests(self):
        async def ok(scope, receive, send):
            await JSONResponse({})(scope, receive, send)

        reset_rate_limits()
        client = TestClient(AnalysisRateLimit(ok, per_minute=2))
        statuses = [client.post("/analyses").status_code for _ in range(3)] + [client.get("/analyses").status_code]
        self.assertEqual(statuses, [200, 200, 429, 200])

    def test_brands_endpoint_returns_initial_brands(self):
        response = self.client.get("/brands")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 5)
        self.assertEqual(response.json()[1]["name"], "Apple")


if __name__ == "__main__":
    unittest.main()


class ReturnGuideTests(unittest.TestCase):
    def test_an_own_mall_without_return_terms_borrows_them_from_its_guide_page(self):
        import main
        page = ProductPage(final_url="https://shop.example/p/1", title="상품", text="상품 설명 " * 2000 + "상호 테스트몰 사업자등록번호 123-45-67891",
                           policy_links=["https://shop.example/guide"])
        guide = ProductPage(final_url="https://shop.example/guide", title="이용안내",
                            text="회원 가입 안내. 상품 수령 후 7일 이내 반품 가능합니다. 반품 배송비 3,000원은 고객 부담입니다.")
        with patch("main.fetch_product_page", return_value=guide) as fetch:
            result = main.with_return_policy(page)
        fetch.assert_called_once_with("https://shop.example/guide")
        self.assertTrue(result.text.startswith("반품·교환 안내(같은 쇼핑몰 안내 페이지 https://shop.example/guide):"))
        self.assertIn("7일 이내 반품 가능합니다.", result.text)
        self.assertNotIn("회원 가입", result.text.split("\n\n")[0])
        self.assertLessEqual(len(result.text), 12000)
        self.assertTrue(result.text.endswith("사업자등록번호 123-45-67891"))
        # A page that already shows its terms is left alone.
        shown = ProductPage(final_url="https://shop.example/p/2", title="상품", text="수령 후 7일 이내 반품 가능", policy_links=["x"])
        self.assertIs(main.with_return_policy(shown), shown)


class ScreenshotTextTests(unittest.TestCase):
    def test_screenshot_text_is_checked_like_page_text(self):
        import base64
        import main
        from io import BytesIO
        from PIL import Image
        buffer = BytesIO()
        Image.new("RGB", (8, 8), "white").save(buffer, "PNG")
        png = base64.b64encode(buffer.getvalue()).decode()
        screen = "판매자 정보\n상호/대표자\n테스트무역 / 홍길동\nA 재고 문의는 카톡 ID sale77 로 주시면 더 저렴하게 드려요"
        with patch("main.transcribe_images", return_value=screen), patch("main.extract_product_details",
                return_value=(main.unknown_product(), [])), patch("main.analyze_product") as analyze:
            from schemas import MarketPrice, OfficialLookup, SellerVerification
            analyze.return_value = (OfficialLookup(status="not_supported", message="-"), None, RiskAnalysis(),
                                    SellerVerification(), MarketPrice())
            body = TestClient(main.app).post("/analyses", json={"product_url": "https://www.coupang.com/vp/products/1",
                                                               "images": [{"mime_type": "image/png", "base64_data": png}]}).json()
        text = analyze.call_args.args[3]
        self.assertTrue(text.startswith("화면 캡처에서 읽은 글자:\n판매자 정보"))
        self.assertIn("카톡 ID sale77", body["sale_text"])
        self.assertIn("AI가 옮겨 적은 것", body["warnings"][0])


class AllowedOriginTests(unittest.TestCase):
    def test_a_deployment_names_its_web_address_and_empty_keeps_the_local_default(self):
        import importlib
        import os
        import main
        for value, allowed, refused in [("https://safepick.expo.app", "https://safepick.expo.app", "http://localhost:8081"),
                                        ("", "http://localhost:8081", "https://safepick.expo.app")]:
            with self.subTest(value=value), patch.dict(os.environ, {"SAFEPICK_ALLOWED_ORIGINS": value}):
                client = TestClient(importlib.reload(main).app)
                ask = lambda origin: client.options("/analyses", headers={"Origin": origin, "Access-Control-Request-Method": "POST"})
                self.assertEqual(ask(allowed).headers.get("access-control-allow-origin"), allowed)
                self.assertIsNone(ask(refused).headers.get("access-control-allow-origin"))
        importlib.reload(main)
