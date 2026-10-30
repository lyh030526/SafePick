"""Opt-in actual local HTTP API evaluation of freshly captured real public pages.

Run the browser companion first. No fixtures, search-result substitution, or API mocks.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import argparse
import json
from pathlib import Path
import re

import httpx


ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / "docs/validation/2026-10-28/week5-real-products"


def normalized(value):
    return " ".join(value.split())


def evaluate(case):
    payload = {
        "product_url": case["collected_url"],
        "provided_text": case["collected_text"],
        "page_title": case["collected_title"],
        "input_source": "browser_extension",
        "captured_at": case["collected_at"],
    }
    started = datetime.now(timezone.utc).isoformat()
    with httpx.Client(timeout=240, trust_env=False) as client:
        response = client.post("http://127.0.0.1:8000/analyses", json=payload)
    result = response.json()
    if response.status_code != 200:
        return {"id": case["id"], "http_status": response.status_code, "response": result}
    risk = result["risk_analysis"]
    text = normalized(case["collected_text"])
    quotes = [quote for item in risk["checklist"] for quote in item["quotes"]]
    quotes += [quote for item in risk["conditions"].values() for quote in item["quotes"]]
    ungrounded = [quote for quote in quotes if normalized(quote) not in text]
    product = result["product"]
    observed_returns = any(phrase in case["collected_text"] for phrase in (
        "반품 신청이 가능합니다", "교환/반품은 불가", "무료교환반품", "100% 교환 해드리겠습니다",
    ))
    price = product["price"]
    # A sanity check, not proof of the correct price tier/selected option.
    digits = re.sub(r"\D", "", price)
    compact_text = case["collected_text"].replace(",", "")
    price_appears = None if price == "확인 불가" else bool(digits and digits in compact_text)
    return {
        "id": case["id"], "requested_url": case["requested_url"], "analyzed_at": started,
        "fresh_page_fetch": True, "synthetic": False, "http_status": response.status_code,
        "source_url_preserved": result["source"]["final_url"] == case["requested_url"],
        "source_kind": result["source"]["kind"],
        "all_quotes_grounded": not ungrounded, "ungrounded_quotes": ungrounded,
        "price_digits_present_in_source": price_appears,
        "attention": [item["category"] for item in risk["checklist"] if item["kind"] == "attention"],
        "needs_check": [item["id"] for item in risk["checklist"] if item["kind"] == "needs_check"],
        "condition_statuses": {key: value["status"] for key, value in risk["conditions"].items()},
        "concrete_return_terms_in_collected_text": observed_returns,
        "required_observed_conditions_found": (
            risk["conditions"]["shipping"]["status"] == "found"
            and (not observed_returns or risk["conditions"]["returns"]["status"] == "found")
        ),
        "response": result,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--cases", nargs="*")
    args = parser.parse_args()
    collection = json.loads((OUTPUT / "collection.json").read_text(encoding="utf-8"))
    cases = [case for case in collection["cases"] if case.get("extracted") and case.get("expected_product_visible")]
    report = {"checked_at": datetime.now(timezone.utc).isoformat(),
              "method": "Fresh live browser extension captures sent to actual local POST /analyses; no mocks",
              "collection_attempts": len(collection["cases"]), "analysis_cases": len(cases), "cases": []}
    if args.cases:
        previous = json.loads((OUTPUT / "analysis.json").read_text(encoding="utf-8"))
        report["cases"] = [case for case in previous["cases"] if case["id"] not in args.cases]
        cases = [case for case in cases if case["id"] in args.cases]
    def save():
        (OUTPUT / "analysis.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = {executor.submit(evaluate, case): case["id"] for case in cases}
        for future in as_completed(futures):
            try:
                result = future.result()
            except Exception as error:
                result = {"id": futures[future], "error": type(error).__name__}
            report["cases"].append(result)
            save()
            summary = {key: value for key, value in result.items() if key != "response"}
            summary["product"] = result.get("response", {}).get("product")
            summary["risk_status"] = result.get("response", {}).get("risk_analysis", {}).get("status")
            print(json.dumps(summary, ensure_ascii=True), flush=True)
    if any(case.get("http_status") != 200 or not case.get("all_quotes_grounded")
           or not case.get("required_observed_conditions_found") for case in report["cases"]):
        raise SystemExit("Real-product evaluation requires review; see analysis.json")
