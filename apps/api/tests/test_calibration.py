import json
import tempfile
import unittest
from pathlib import Path

from calibration import Settings, add_case, evaluate, labeled_rows, load_cases, rank_key, replay
from risk_assessment import ScoreParams
from schemas import MarketPrice, RiskAssessment, SellerVerification
from test_risk_assessment import analyzed, official, unmatched_comparison


def response(market=None, seller="active", comparison=True):
    return {"risk_analysis": analyzed().model_dump(mode="json"),
            "comparison": {True: official, "unmatched": unmatched_comparison}[comparison]().model_dump(mode="json")
            if comparison else None,
            "seller_verification": SellerVerification(status=seller, label=seller).model_dump(mode="json"),
            "market_price": (market or MarketPrice(status="no_model")).model_dump(mode="json")}


def assessed(level, score=None):
    return RiskAssessment(level=level, score=score)


class CaseStoreTests(unittest.TestCase):
    def test_add_case_validates_and_stores_text(self):
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder)
            with self.assertRaises(ValueError):
                add_case(url="https://a.example", label="scam", source="x", text="본문", data_dir=data)
            with self.assertRaises(ValueError):
                add_case(url="https://a.example", label="risky", source=" ", text="본문", data_dir=data)
            self.assertEqual(add_case(url="https://a.example", label="risky", source="피해 신고", text=" 본문 ",
                                      data_dir=data), "c001")
            self.assertEqual(add_case(url="https://b.example", label="unlabeled", source="", text="본문2",
                                      data_dir=data), "c002")
            with self.assertRaises(ValueError):
                add_case(url="https://c.example", label="trusted", source="공식", text="본문", case_id="c001", data_dir=data)
            self.assertEqual([case["label"] for case in load_cases(data)], ["risky", "unlabeled"])
            self.assertEqual((data / "texts" / "c001.txt").read_text(encoding="utf-8"), "본문")


class ReplayTests(unittest.TestCase):
    def test_market_thresholds_are_reapplied_from_the_saved_ratio(self):
        saved = response(MarketPrice(status="below", label="시세보다 저렴", ratio_percent=55))
        self.assertEqual(replay(saved).level, "undetermined")
        stricter = replay(saved, Settings(far_below=60, below=80))
        self.assertEqual(stricter.level, "moderate")
        self.assertIn("가격 시세: 시세보다 지나치게 저렴 (중앙값의 55%)", stricter.reasons)
        self.assertEqual(replay(saved, Settings(far_below=40, below=50)).level, "low")

    def test_score_params_change_only_the_score(self):
        saved = response(comparison="unmatched")
        default, harsh = replay(saved), replay(saved, Settings(ScoreParams(unknown_credit=0.0)))
        self.assertEqual(default.level, harsh.level)
        self.assertGreater(default.score, harsh.score)

    def test_rows_skip_cases_without_snapshots_and_optionally_synthetic(self):
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder)
            for case_id, synthetic in [("real", False), ("fake", True), ("pending", False)]:
                add_case(url="https://a.example", label="trusted", source="공식", text="본문", case_id=case_id,
                         synthetic=synthetic, data_dir=data)
            (data / "snapshots").mkdir()
            for case_id in ("real", "fake"):
                (data / "snapshots" / f"{case_id}.json").write_text(json.dumps({"response": response()}), encoding="utf-8")
            cases = load_cases(data)
            self.assertEqual([case["id"] for case, _ in labeled_rows(Settings(), cases, data)], ["real", "fake"])
            self.assertEqual([case["id"] for case, _ in labeled_rows(Settings(), cases, data, include_synthetic=False)], ["real"])


class MetricTests(unittest.TestCase):
    def test_metrics_follow_the_labels(self):
        rows = [({"label": "trusted"}, assessed("low", 95)), ({"label": "trusted"}, assessed("moderate", 50)),
                ({"label": "risky"}, assessed("high", 10)), ({"label": "risky"}, assessed("undetermined", None)),
                ({"label": "unlabeled"}, assessed("low", 90))]
        metrics = evaluate(rows)
        self.assertEqual((metrics["trusted"], metrics["risky"], metrics["unlabeled"]), (2, 2, 1))
        self.assertEqual((metrics["detection_rate"], metrics["false_alarm_rate"], metrics["trusted_low_rate"]), (0.5, 0.5, 0.5))
        self.assertEqual((metrics["risky_cleared"], metrics["score_separation"], metrics["scored"]), (0, 1.0, 3))
        self.assertEqual(metrics["confusion"]["risky"], {"high": 1, "moderate": 0, "undetermined": 1, "low": 0})

    def test_missing_classes_leave_rates_empty(self):
        metrics = evaluate([({"label": "trusted"}, assessed("low", 90))])
        self.assertIsNone(metrics["detection_rate"])
        self.assertIsNone(metrics["score_separation"])

    def test_clearing_a_risky_page_outranks_any_gain(self):
        safe = evaluate([({"label": "risky"}, assessed("undetermined")), ({"label": "trusted"}, assessed("moderate", 40))])
        cleared = evaluate([({"label": "risky"}, assessed("low", 90)), ({"label": "trusted"}, assessed("low", 95))])
        self.assertLess(rank_key(safe), rank_key(cleared))


if __name__ == "__main__":
    unittest.main()
