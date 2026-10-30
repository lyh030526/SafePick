"""Explicit opt-in smoke test: two real image calls using fictional product data."""
import base64
import json
import sys
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw, ImageFont
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main
from comparison import parse_price


def make_listing():
    image = Image.new("RGB", (1200, 860), "white")
    draw = ImageDraw.Draw(image)
    font_path = "C:/Windows/Fonts/malgun.ttf"
    font = ImageFont.truetype(font_path, 38)
    draw.text((55, 40), "가상 상품 / SafePick 이미지 입력 테스트", fill="#1d6fe8", font=font)
    for i, line in enumerate([
        "브랜드: DemoBrand", "상품명: 테스트 무선 헤드폰", "모델명: SP-TEST-100",
        "판매 가격: 129,000원 (KRW)", "판매자: 데모스토어", "구성품: 헤드폰, USB-C 케이블",
    ]):
        draw.text((55, 155 + i * 95), line, fill="#172033", font=font)
    return image


if __name__ == "__main__":
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("../../docs/validation/2026-10-28/material-input")
    output.mkdir(parents=True, exist_ok=True)
    listing = make_listing()
    listing.save(output / "synthetic-product.png")
    cases = [("synthetic_product", listing), ("blank_image", Image.new("RGB", (400, 300), "white"))]
    results = []
    client = TestClient(main.app)
    for name, image in cases:
        buffer = BytesIO()
        image.save(buffer, format="PNG")
        with patch("main.fetch_product_page", side_effect=AssertionError("seller page must not be fetched")):
            response = client.post("/analyses", json={
                "product_url": "https://smartstore.naver.com/demo/products/12345",
                "images": [{"mime_type": "image/png", "base64_data": base64.b64encode(buffer.getvalue()).decode()}],
            })
        assert response.status_code == 200, response.status_code
        body = response.json()
        product = body["product"]
        if name == "synthetic_product":
            assert product["model_number"] == "SP-TEST-100", product
            assert parse_price(product["price"]) == 129000, product
            assert product["currency"] == "KRW", product
            assert product["brand_name"] == "DemoBrand", product
            assert product["seller_name"] == "데모스토어", product
        else:
            for field in ("brand_name", "product_name", "model_number", "price", "seller_name"):
                assert product[field] == "확인 불가", product
        results.append({"case": name, "synthetic": True, "status_code": response.status_code, "result": body})
        print(f"PASS {name}: image-only extraction and unverified source metadata")
    (output / "live-image-results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
