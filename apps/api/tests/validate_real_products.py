"""Opt-in validation: real HTTP pages, search and configured LLM; no service mocks.

Run from apps/api. JSON artifacts contain public product information, never credentials.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from threading import Lock
from time import monotonic
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

import main
from comparison import compare_product
from official_brands import find_official_brand
from schemas import OfficialLookup, OfficialSearchResult, ProductDetails, UNKNOWN
from scraper import fetch_product_page


CASES = [
    {"id": "samsung-buds3", "brand": "삼성전자", "model": "SM-R530NZAAKOO", "name": "갤럭시 버즈3",
     "url": "https://www.samsung.com/sec/store-mobile/galaxy-buds3-r530-10/SM-R530NZAAKOO/"},
    {"id": "apple-airpods", "brand": "Apple", "model": "", "name": "AirPods Pro 3",
     "url": "https://www.apple.com/kr/airpods-pro/"},
    {"id": "lg-monitor", "brand": "LG전자", "model": "27UP850K", "name": "LG 울트라HD 모니터",
     "url": "https://www.lge.co.kr/product/monitors/27up850k?modelId=MD10491828&pdpType=PURCHASE"},
    {"id": "dyson-nural", "brand": "다이슨", "model": "HD16", "name": "슈퍼소닉 뉴럴",
     "url": "https://www.dyson.co.kr/supersonic-nural-hair-dryer-jasper-plum"},
    {"id": "sony-headphones", "brand": "소니", "model": "WH-1000XM5", "name": "WH-1000XM5",
     "url": "https://www.sony.co.kr/electronics/headband-headphones/wh-1000xm5"},
    {"id": "sony-specifications", "brand": "소니", "model": "WH-1000XM5", "name": "WH-1000XM5",
     "url": "https://www.sony.co.kr/electronics/headband-headphones/wh-1000xm5/specifications"},
    {"id": "apple-purchase", "brand": "Apple", "model": "", "name": "AirPods Pro 3",
     "url": "https://www.apple.com/kr/shop/product/mfhp4kh/a/airpods-pro-3"},
    {"id": "coupang-airpods", "brand": "Apple", "model": "", "name": "AirPods Pro 2",
     "url": "https://www.coupang.com/vp/products/7608804797?itemId=20146298818&vendorItemId=87239403818"},
]


def normalized(value):
    return "".join(char for char in value.casefold() if char.isalnum())


def run_case(case, preflight):
    started = monotonic()
    if preflight:
        try:
            page = fetch_product_page(case["url"])
            return {**case, "seconds": round(monotonic() - started, 1), "collection": "readable",
                    "page": {"title": page.title, "url": page.final_url, "text": page.text}}
        except Exception as error:
            return {**case, "collection": "blocked", "error": str(error), "seconds": round(monotonic() - started, 1)}
    with TestClient(main.app) as client:
        response = client.post("/analyses", json={"product_url": case["url"]})
    payload = response.json()
    outcome = "needs_review"
    if response.status_code == 200:
        source = payload["source"]
        extracted = payload["product"]
        if source["text_length"] == 0:
            outcome = "collection_blocked_manual_input"
        elif not find_official_brand(extracted["brand_name"]):
            outcome = "extraction_missing_brand"
        elif find_official_brand(extracted["brand_name"]).name != case["brand"]:
            outcome = "wrong_brand"
        elif case["model"] and normalized(case["model"]) not in normalized(extracted["model_number"]):
            outcome = "model_missing_or_different"
        elif payload.get("comparison", {}).get("status") == "exact":
            outcome = "exact_confirmed"
        else:
            outcome = "comparison_needs_review"
    return {**case, "seconds": round(monotonic() - started, 1), "http_status": response.status_code,
            "outcome": outcome, "response": payload}


def run_control(accessory):
    case_id = "control-accessory" if accessory else "control-different-generation"
    product = ProductDetails(
        brand_name="Apple", product_name="AirPods Pro 3 호환 실리콘 케이스" if accessory else "AirPods Pro 2",
        model_number=UNKNOWN, price=UNKNOWN, currency=UNKNOWN,
        seller_name=UNKNOWN, components=[UNKNOWN],
    )
    url = CASES[1]["url"]
    lookup = OfficialLookup(status="found", message="실제 공식 페이지에 대한 변경 입력 대조군",
                            results=[OfficialSearchResult(title="AirPods Pro 3", url=url, snippet="")])
    comparison = compare_product(product, url, lookup)
    outcome = "false_exact" if comparison.status == "exact" else (
        "inconclusive" if comparison.status == "unknown" else "pass"
    )
    return {"id": case_id, "input_kind": "controlled_changed_input_not_a_real_sale",
            "url": url, "input": product.model_dump(), "outcome": outcome,
            "response": {"comparison": comparison.model_dump()}}


def run_price_control():
    with TestClient(main.app) as client:
        response = client.post("/comparisons", json={
            "product_url": CASES[6]["url"],
            "product": {
                "brand_name": "Apple", "product_name": "AirPods Pro 3", "model_number": UNKNOWN,
                "price": "299000", "currency": "KRW", "seller_name": UNKNOWN, "components": [UNKNOWN],
            },
        })
    payload = response.json()
    price = payload.get("comparison", {}).get("price", {})
    return {"id": "control-user-entered-price", "input_kind": "controlled_price_not_observed_retailer_sale",
            "note": "299000 KRW is a test input; the official price is fetched live, not mocked.",
            "outcome": "pass" if response.status_code == 200 and price.get("status") == "available" else "inconclusive",
            "response": payload}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--preflight", action="store_true")
    parser.add_argument("--cases", nargs="*")
    parser.add_argument("--controls", action="store_true")
    parser.add_argument("--price-control", action="store_true")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    selected = [case for case in CASES if not args.cases or case["id"] in args.cases]
    report = {"checked_at_utc": datetime.now(timezone.utc).isoformat(), "preflight": args.preflight, "cases": []}
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    pages = []
    lock = Lock()
    real_fetch = fetch_product_page

    def recorded_fetch(url, allowed_domains=None):
        page = real_fetch(url, allowed_domains=allowed_domains)
        with lock:
            pages.append({"requested_url": url, "final_url": page.final_url, "title": page.title, "text": page.text})
        return page

    def save():
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        output.with_name(output.stem + "-pages.json").write_text(
            json.dumps(pages, ensure_ascii=False, indent=2), encoding="utf-8",
        )

    # These wrappers record actual collected public text; they never substitute page content.
    with patch("main.fetch_product_page", side_effect=recorded_fetch), patch("comparison.fetch_product_page", side_effect=recorded_fetch):
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = {executor.submit(run_case, case, args.preflight): case["id"] for case in selected}
            for future in as_completed(futures):
                try:
                    result = future.result()
                except Exception as error:
                    result = {"id": futures[future], "outcome": "error", "error": type(error).__name__}
                report["cases"].append(result)
                save()
                print(result["id"], result.get("outcome", result.get("collection")), flush=True)
        if args.controls and not args.preflight:
            for accessory in (False, True):
                result = run_control(accessory)
                report["cases"].append(result)
                save()
                print(result["id"], result["outcome"], flush=True)
        if args.price_control and not args.preflight:
            result = run_price_control()
            report["cases"].append(result)
            save()
            print(result["id"], result["outcome"], flush=True)
    print("Report:", output, flush=True)
