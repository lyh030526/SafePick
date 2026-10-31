"""Replay saved real/model evidence against the new deterministic grade policy.

Does not recollect Naver pages, call a model, or revalidate the original extraction.
"""
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from risk_assessment import assess_risk
from schemas import ProductComparison, RiskAnalysis


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[3]
    source = root / "docs/validation/2026-10-28"
    output = source / "risk-levels"
    output.mkdir(parents=True, exist_ok=True)
    real = json.loads((source / "week5-real-products/analysis.json").read_text(encoding="utf-8"))
    controls = json.loads((source / "week5/live-evaluation.json").read_text(encoding="utf-8"))
    reports = []
    for case in real["cases"]:
        response = case["response"]
        risk = RiskAnalysis.model_validate(response["risk_analysis"])
        comparison = ProductComparison.model_validate(response["comparison"]) if response.get("comparison") else None
        result = assess_risk(risk, comparison)
        reports.append({"id": case["id"], "input_kind": "previously_captured_real_product",
                        "url": case["requested_url"], "assessment": result.model_dump(),
                        "expected_level": "undetermined", "passed": result.level == "undetermined"})
    expected = {"normal_clear_terms": "undetermined", "promotion_and_ambiguous_return": "moderate",
                "conflicting_models": "high", "conflicting_components": "high",
                "compatible_accessory_not_model_conflict": "undetermined"}
    for case in controls:
        if not case["synthetic"]:
            continue
        result = assess_risk(RiskAnalysis.model_validate(case["result"]), None)
        reports.append({"id": case["case"], "input_kind": "previous_model_synthetic_control",
                        "assessment": result.model_dump(), "expected_level": expected[case["case"]],
                        "passed": result.level == expected[case["case"]]})
    report = {"checked_at": datetime.now(timezone.utc).isoformat(), "fresh_page_fetch": False,
              "new_model_calls": False, "rule_version": "7", "cases": reports}
    (output / "replayed-evidence.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    for case in reports:
        print(case["id"], case["assessment"]["level"], "PASS" if case["passed"] else "REVIEW")
    if not all(case["passed"] for case in reports):
        raise SystemExit("Risk policy replay requires review")
