"""Optional live smoke test; uses the API server's configured search and AI keys."""
import json

import httpx


if __name__ == "__main__":
    response = httpx.post("http://127.0.0.1:8000/comparisons", timeout=150, json={
        "product_url": "https://www.coupang.com/vp/products/7608804797",
        "product": {
            "brand_name": "Apple", "product_name": "AirPods Pro 3", "model_number": "확인 불가",
            "price": "299000", "currency": "KRW", "seller_name": "확인 불가", "components": ["확인 불가"],
        },
    })
    response.raise_for_status()
    payload = response.json()
    assert payload["comparison"]["status"] in {"exact", "similar", "not_found", "unknown"}
    print(json.dumps(payload, ensure_ascii=True, indent=2))
