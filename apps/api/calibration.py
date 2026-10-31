"""Labeled sales-page cases for checking and tuning the risk level and trust score.

Cases live in data/calibration: cases.jsonl (one labeled case per line), texts/<id>.txt (the collected
page text), and snapshots/<id>.json (one full analysis). Snapshots are taken once, because they call
OpenAI, Serper, and the NTS API; report and tune only replay the saved evidence through the current
rules, so settings can be compared without new calls.

    python calibration.py add --label risky --source "피해 신고 3건 (더치트)" --url URL --text-file page.txt
    python calibration.py snapshot
    python calibration.py report
    python calibration.py tune
"""
import argparse
import itertools
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from market_price import BELOW_PERCENT, FAR_BELOW_PERCENT, rate_ratio
from risk_assessment import DEFAULT_PARAMS, WEIGHTS, ScoreParams, assess_risk
from schemas import DomainCheck, MarketPrice, ProductComparison, RiskAnalysis, RiskAssessment, SellerVerification

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "calibration"
LABELS = ("trusted", "risky", "unlabeled")
FLAGGED = {"high", "moderate"}
# Fewer labeled real cases than this per class make any tuning result anecdotal.
MIN_PER_CLASS = 10


@dataclass(frozen=True)
class Settings:
    params: ScoreParams = DEFAULT_PARAMS
    far_below: int = FAR_BELOW_PERCENT
    below: int = BELOW_PERCENT
    name: str = "현재 설정"


def load_cases(data_dir: Path = DATA_DIR) -> list[dict]:
    path = data_dir / "cases.jsonl"
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def add_case(*, url: str, label: str, source: str, text: str, title: str = "", synthetic: bool = False,
             note: str = "", case_id: str | None = None, captured_at: str | None = None,
             data_dir: Path = DATA_DIR) -> str:
    if label not in LABELS:
        raise ValueError(f"label은 {', '.join(LABELS)} 중 하나여야 합니다.")
    if label != "unlabeled" and not source.strip():
        raise ValueError("라벨의 근거(--source)를 적어 주세요. 예: '공식 브랜드 스토어', '피해 신고 3건'.")
    if not text.strip():
        raise ValueError("판매 페이지 텍스트가 비어 있습니다.")
    cases = load_cases(data_dir)
    case_id = case_id or f"c{len(cases) + 1:03d}"
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,60}", case_id) or any(case["id"] == case_id for case in cases):
        raise ValueError(f"사용할 수 없거나 이미 있는 id입니다: {case_id}")
    (data_dir / "texts").mkdir(parents=True, exist_ok=True)
    (data_dir / "texts" / f"{case_id}.txt").write_text(text.strip(), encoding="utf-8")
    record = {"id": case_id, "url": url, "title": title, "label": label, "label_source": source.strip(),
              "synthetic": synthetic, "captured_at": captured_at or datetime.now(timezone.utc).isoformat(),
              "note": note}
    with (data_dir / "cases.jsonl").open("a", encoding="utf-8") as file:
        file.write(json.dumps(record, ensure_ascii=False) + "\n")
    return case_id


def take_snapshot(case: dict, data_dir: Path = DATA_DIR) -> dict:
    import main  # Imported here: loads .env and the model clients only when a snapshot is taken.
    from schemas import AnalysisRequest

    text = (data_dir / "texts" / f"{case['id']}.txt").read_text(encoding="utf-8")
    response = main.create_analysis(AnalysisRequest(product_url=case["url"], provided_text=text[:12000],
                                                    page_title=case.get("title", "")[:300],
                                                    input_source="browser_extension"))
    snapshot = {"case_id": case["id"], "snapshot_at": datetime.now(timezone.utc).isoformat(),
                "response": response.model_dump(mode="json")}
    (data_dir / "snapshots").mkdir(parents=True, exist_ok=True)
    (data_dir / "snapshots" / f"{case['id']}.json").write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=1), encoding="utf-8")
    return snapshot


def load_snapshot(case_id: str, data_dir: Path = DATA_DIR) -> dict | None:
    path = data_dir / "snapshots" / f"{case_id}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def replay(response: dict, settings: Settings = Settings()) -> RiskAssessment:
    """Recompute the assessment from saved evidence under `settings`, without any network call."""
    analysis = RiskAnalysis.model_validate(response["risk_analysis"])
    comparison = ProductComparison.model_validate(response["comparison"]) if response.get("comparison") else None
    # A brand without a supported official site is left out of the score, as in a live analysis.
    if comparison is not None and comparison.status == "unknown" and "지원 브랜드" in comparison.message:
        comparison = None
    seller = SellerVerification.model_validate(response["seller_verification"]) if response.get("seller_verification") else None
    market = MarketPrice.model_validate(response["market_price"]) if response.get("market_price") else None
    if market is not None and market.ratio_percent is not None:
        status, label, message = rate_ratio(market.ratio_percent, settings.far_below, settings.below)
        market = market.model_copy(update={"status": status, "label": label, "message": message})
    saved = (response["risk_analysis"].get("assessment") or {}).get("domain")
    domain = DomainCheck.model_validate(saved) if saved else None
    return assess_risk(analysis, comparison, seller, market, settings.params, domain=domain)


def evaluate(rows: list[tuple[dict, RiskAssessment]]) -> dict:
    """Agreement between labels and assessments; unlabeled cases are counted but not scored."""
    trusted = [result for case, result in rows if case["label"] == "trusted"]
    risky = [result for case, result in rows if case["label"] == "risky"]
    confusion = {label: {level: 0 for level in ("high", "moderate", "undetermined", "low")} for label in LABELS}
    for case, result in rows:
        confusion[case["label"]][result.level] += 1
    rate = lambda part, whole: round(len(part) / len(whole), 3) if whole else None
    trusted_scores = [result.score for result in trusted if result.score is not None]
    risky_scores = [result.score for result in risky if result.score is not None]
    pairs = [(t, r) for t in trusted_scores for r in risky_scores]
    return {
        "trusted": len(trusted), "risky": len(risky), "unlabeled": len(rows) - len(trusted) - len(risky),
        # Share of risky pages shown as high or moderate.
        "detection_rate": rate([r for r in risky if r.level in FLAGGED], risky),
        # Risky pages shown as low: the costliest error, it should stay at zero.
        "risky_cleared": sum(r.level == "low" for r in risky),
        # Share of trusted pages wrongly shown as high or moderate.
        "false_alarm_rate": rate([r for r in trusted if r.level in FLAGGED], trusted),
        "trusted_low_rate": rate([r for r in trusted if r.level == "low"], trusted),
        # Chance a trusted page scores above a risky one (0.5 = no separation).
        "score_separation": round(sum(1.0 if t > r else 0.5 if t == r else 0.0 for t, r in pairs) / len(pairs), 3)
        if pairs else None,
        "scored": len(trusted_scores) + len(risky_scores),
        "confusion": confusion,
    }


def candidate_settings() -> list[Settings]:
    presets = {
        "현재 가중치": dict(WEIGHTS),
        "판매자 중심": {"official": 20, "description": 15, "purchase_terms": 10, "seller": 35, "price": 20},
        "가격 중심": {"official": 20, "description": 15, "purchase_terms": 15, "seller": 25, "price": 25},
        "설명 중심": {"official": 20, "description": 30, "purchase_terms": 20, "seller": 20, "price": 10},
        "균등": {key: 20 for key in WEIGHTS},
    }
    settings = []
    for (name, weights), credit, (far, below) in itertools.product(
            presets.items(), (0.3, 0.5), [(40, 60), (40, 70), (50, 70), (50, 80), (60, 80)]):
        settings.append(Settings(ScoreParams(weights=weights, unknown_credit=credit), far, below,
                                 f"{name} · 미확인 {credit} · 시세 {far}%/{below}%"))
    return settings


def rank_key(metrics: dict) -> tuple:
    # Never clear a risky page first, then catch more risky pages with fewer false alarms, then separate scores.
    gain = (metrics["detection_rate"] or 0) - (metrics["false_alarm_rate"] or 0)
    return metrics["risky_cleared"], -gain, -(metrics["score_separation"] or 0)


def labeled_rows(settings: Settings, cases: list[dict], data_dir: Path = DATA_DIR,
                 include_synthetic: bool = True) -> list[tuple[dict, RiskAssessment]]:
    rows = []
    for case in cases:
        snapshot = load_snapshot(case["id"], data_dir)
        if snapshot and (include_synthetic or not case.get("synthetic")):
            rows.append((case, replay(snapshot["response"], settings)))
    return rows


def _print_metrics(metrics: dict) -> None:
    percent = lambda value: "-" if value is None else f"{value * 100:.0f}%"
    print(f"사례: 정상 {metrics['trusted']} · 위험 {metrics['risky']} · 미분류 {metrics['unlabeled']}")
    print(f"위험 사례 탐지율(높음·보통) {percent(metrics['detection_rate'])} · 위험 사례를 '낮음'으로 놓침 {metrics['risky_cleared']}건")
    print(f"정상 사례 오경보율 {percent(metrics['false_alarm_rate'])} · 정상 사례 '낮음' 비율 {percent(metrics['trusted_low_rate'])}")
    separation = metrics["score_separation"]
    print(f"점수 분리도 {'-' if separation is None else separation} (점수가 매겨진 사례 {metrics['scored']}개, 0.5 = 구분 못 함)")
    print("라벨별 주의 수준:  높음  보통  보류  낮음")
    for label, name in (("trusted", "정상"), ("risky", "위험"), ("unlabeled", "미분류")):
        row = metrics["confusion"][label]
        print(f"  {name:<6}         {row['high']:>4}  {row['moderate']:>4}  {row['undetermined']:>4}  {row['low']:>4}")


def main_cli(argv: list[str] | None = None) -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="SafePick 라벨 사례 평가·보정")
    commands = parser.add_subparsers(dest="command", required=True)
    add = commands.add_parser("add", help="라벨 사례 추가")
    add.add_argument("--url", required=True)
    add.add_argument("--label", required=True, choices=LABELS)
    add.add_argument("--source", default="", help="라벨의 근거")
    add.add_argument("--text-file", required=True, help="확장 미리보기의 텍스트를 저장한 파일")
    add.add_argument("--title", default="")
    add.add_argument("--id")
    add.add_argument("--note", default="")
    add.add_argument("--synthetic", action="store_true", help="실제 페이지가 아닌 가상 사례")
    snapshot = commands.add_parser("snapshot", help="스냅샷이 없는 사례를 분석해 저장 (OpenAI·Serper·국세청 호출)")
    snapshot.add_argument("--force", action="store_true", help="이미 있는 스냅샷도 다시 분석")
    snapshot.add_argument("--id", action="append", help="이 사례만 (여러 번 지정 가능)")
    commands.add_parser("report", help="현재 설정으로 평가")
    tune = commands.add_parser("tune", help="가중치·시세 기준 후보 비교")
    tune.add_argument("--include-synthetic", action="store_true", help="가상 사례도 포함 (구조 확인용)")
    args = parser.parse_args(argv)

    if args.command == "add":
        case_id = add_case(url=args.url, label=args.label, source=args.source, title=args.title, note=args.note,
                           text=Path(args.text_file).read_text(encoding="utf-8"), synthetic=args.synthetic,
                           case_id=args.id)
        print(f"추가했습니다: {case_id}. 'python calibration.py snapshot'으로 분석을 저장하세요.")
        return
    cases = load_cases()
    if args.command == "snapshot":
        targets = [case for case in cases if (not args.id or case["id"] in args.id)
                   and (args.force or load_snapshot(case["id"]) is None)]
        for index, case in enumerate(targets, 1):
            result = take_snapshot(case)["response"]["risk_analysis"]["assessment"]
            print(f"[{index}/{len(targets)}] {case['id']}: {result['label']} · 점수 {result['score']}")
        print(f"스냅샷 {len(targets)}개를 저장했습니다." if targets else "새로 분석할 사례가 없습니다.")
        return
    if args.command == "report":
        rows = labeled_rows(Settings(), cases)
        metrics = evaluate(rows)
        _print_metrics(metrics)
        missing = len(cases) - len(rows)
        if missing:
            print(f"스냅샷이 없는 사례 {missing}개는 빠졌습니다. 'python calibration.py snapshot'을 먼저 실행하세요.")
        report = {"checked_at": datetime.now(timezone.utc).isoformat(), "settings": "현재 설정", "metrics": metrics,
                  "cases": [{"id": case["id"], "label": case["label"], "synthetic": case.get("synthetic", False),
                             "level": result.level, "score": result.score, "coverage_percent": result.coverage_percent,
                             "reasons": result.reasons} for case, result in rows]}
        (DATA_DIR / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"자세한 결과: {DATA_DIR / 'report.json'}")
        return
    real = [case for case in cases if not case.get("synthetic") and case["label"] != "unlabeled"]
    counts = {label: sum(case["label"] == label for case in real) for label in ("trusted", "risky")}
    if min(counts.values()) < MIN_PER_CLASS:
        print(f"실제 라벨 사례가 정상 {counts['trusted']}개 · 위험 {counts['risky']}개입니다. "
              f"종류별 {MIN_PER_CLASS}개 이상이 되기 전의 결과는 참고용이며 설정을 바꾸는 근거로 쓰지 마세요.")
    results = []
    for settings in candidate_settings():
        metrics = evaluate(labeled_rows(settings, cases, include_synthetic=args.include_synthetic))
        results.append((rank_key(metrics), settings, metrics))
    if not results or not any(metrics["trusted"] and metrics["risky"] for _, _, metrics in results):
        print("정상·위험 라벨 사례가 모두 있어야 비교할 수 있습니다." +
              ("" if args.include_synthetic else " 구조만 확인하려면 --include-synthetic을 붙이세요."))
        return
    results.sort(key=lambda item: item[0])
    current = next(metrics for _, settings, metrics in results
                   if settings.params.weights == WEIGHTS and settings.params.unknown_credit == DEFAULT_PARAMS.unknown_credit
                   and (settings.far_below, settings.below) == (FAR_BELOW_PERCENT, BELOW_PERCENT))
    print("== 현재 설정")
    _print_metrics(current)
    for rank, (_, settings, metrics) in enumerate(results[:5], 1):
        print(f"\n== 후보 {rank}: {settings.name}")
        _print_metrics(metrics)


if __name__ == "__main__":
    main_cli()
