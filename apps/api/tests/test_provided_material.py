import base64
import json
import os
import unittest
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

import main
from extractor import extract_product_details, unknown_product
from schemas import AnalysisImage, RiskAnalysis


def image_payload():
    buffer = BytesIO()
    Image.new("RGB", (40, 30), "white").save(buffer, format="PNG")
    return {"mime_type": "image/png", "base64_data": base64.b64encode(buffer.getvalue()).decode()}


class ProvidedMaterialTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.url = "https://smartstore.naver.com/demo/products/12345?option=blue"
        patcher = patch("main.analyze_listing_risks", return_value=RiskAnalysis())
        patcher.start()
        self.addCleanup(patcher.stop)

    @patch("main.fetch_product_page", side_effect=AssertionError("must not fetch seller page"))
    @patch("main.extract_product_details", return_value=(unknown_product(), ["누락 정보 확인 필요"]))
    def test_pasted_text_and_images_bypass_blocked_seller_fetch(self, extract, fetch):
        response = self.client.post("/analyses", json={
            "product_url": self.url, "provided_text": "  상품 설명  ", "images": [image_payload()],
        })
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["source"]["kind"], "mixed")
        self.assertEqual(body["source"]["image_count"], 1)
        self.assertEqual(body["source"]["final_url"], self.url)
        self.assertEqual(body["status"], "manual_input_required")
        self.assertIn("사용자가 제공", body["warnings"][0])
        self.assertEqual(extract.call_args.args[1], "상품 설명")
        self.assertEqual(extract.call_args.kwargs["images"][0].mime_type, "image/png")
        fetch.assert_not_called()

    @patch("main.fetch_product_page", side_effect=AssertionError("must not fetch seller page"))
    @patch("main.extract_product_details", return_value=(unknown_product(), []))
    def test_extension_import_records_unverified_provenance(self, extract, fetch):
        response = self.client.post("/analyses", json={
            "product_url": self.url, "provided_text": "상품명 테스트", "page_title": "상품 페이지",
            "input_source": "browser_extension", "captured_at": "2026-10-28T03:00:00Z",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["source"]["kind"], "browser_extension")
        self.assertEqual(response.json()["source"]["captured_at"], "2026-10-28T03:00:00Z")
        fetch.assert_not_called()

    @patch.dict(os.environ, {}, clear=True)
    @patch("main.fetch_product_page", side_effect=AssertionError("must not fetch seller page"))
    def test_image_only_without_key_keeps_manual_correction_available(self, fetch):
        response = self.client.post("/analyses", json={"product_url": self.url, "images": [image_payload()]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["source"]["kind"], "user_images")
        self.assertEqual(response.json()["product"], unknown_product().model_dump())
        fetch.assert_not_called()

    def test_invalid_or_excessive_images_never_echo_upload(self):
        bad_images = [
            {"mime_type": "image/png", "base64_data": "PRIVATE-UPLOAD-not-an-image"},
            {**image_payload(), "mime_type": "image/jpeg"},
            {"mime_type": "image/svg+xml", "base64_data": "PHN2Zz4="},
        ]
        for image in bad_images:
            response = self.client.post("/analyses", json={"product_url": self.url, "images": [image]})
            self.assertEqual(response.status_code, 422)
            self.assertNotIn(image["base64_data"], response.text)
        response = self.client.post("/analyses", json={"product_url": self.url, "images": [image_payload()] * 4})
        self.assertEqual(response.status_code, 422)

    def test_blank_or_long_material_rejected(self):
        for text in ("   ", "a" * 12001):
            response = self.client.post("/analyses", json={"product_url": self.url, "provided_text": text})
            self.assertEqual(response.status_code, 422)

    def test_large_body_is_rejected_before_json_parsing_with_cors(self):
        response = self.client.post("/analyses", content=b"x" * (12 * 1024 * 1024 + 1),
                                    headers={"Origin": "http://localhost:8081"})
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.headers["access-control-allow-origin"], "http://localhost:8081")

    @patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"})
    @patch("extractor.OpenAI")
    def test_real_image_bytes_are_sent_as_multimodal_content(self, client):
        product = unknown_product().model_dump()
        product["product_name"] = "테스트 상품"
        client.return_value.chat.completions.create.return_value = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(product)))])
        image = AnalysisImage(**image_payload())
        result, warnings = extract_product_details("제목", "가격은 확인 불가", images=[image])
        content = client.return_value.chat.completions.create.call_args.kwargs["messages"][1]["content"]
        self.assertEqual(content[1]["type"], "image_url")
        self.assertEqual(content[1]["image_url"]["url"], f"data:image/png;base64,{image.base64_data}")
        self.assertEqual(content[1]["image_url"]["detail"], "high")
        self.assertEqual(result.price, "확인 불가")
        self.assertTrue(warnings)


if __name__ == "__main__":
    unittest.main()
