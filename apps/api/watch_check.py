"""Follow-up checks for the unlabeled watch cases (watch-*): did the seller's registration change since collection?

A marketplace page that is taken down, or a seller that closes, soon after collection is outside evidence for a risky
label that does not come from SafePick's own analysis. This script records each watch case's NTS and FTC state once
(baseline) and later reports what changed. Whether the page itself was taken down needs a browser (Coupang refuses
server requests), so that column is filled in by hand: --removed ID marks a page found taken down.

    python watch_check.py baseline
    python watch_check.py check
    python watch_check.py check --removed watch-coupang-123
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

from calibration import DATA_DIR, load_cases
from mail_order import with_mail_order
from seller_verification import verify_seller

WATCH_PATH = DATA_DIR / "watch.json"


def seller_state(case: dict) -> dict:
    text = (DATA_DIR / "texts" / f"{case['id']}.txt").read_text(encoding="utf-8")
    result = with_mail_order(verify_seller(text, case["url"]), case["url"], text)
    return {"seller": result.seller.business_name, "number": result.seller.business_number, "nts": result.status,
            "mail_order": result.mail_order.status if result.mail_order else None,
            "rating": result.marketplace_rating, "rating_count": result.rating_count}


def main(argv: list[str] | None = None) -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    # The NTS and FTC keys live in apps/api/.env, which only the model client loads otherwise.
    load_dotenv(Path(__file__).with_name(".env"))
    parser = argparse.ArgumentParser(description="추적 관찰 사례의 사업자 상태 변화 확인")
    parser.add_argument("command", choices=["baseline", "check"])
    parser.add_argument("--removed", action="append", default=[], help="브라우저로 확인해 판매 페이지가 내려간 사례 id")
    args = parser.parse_args(argv)
    cases = [case for case in load_cases() if case["id"].startswith("watch-")]
    saved = json.loads(WATCH_PATH.read_text(encoding="utf-8")) if WATCH_PATH.exists() else {}
    now = datetime.now(timezone.utc).isoformat()
    if args.command == "baseline":
        for case in cases:
            if case["id"] not in saved:
                saved[case["id"]] = {"url": case["url"], "baseline_at": now, "baseline": seller_state(case), "checks": []}
        WATCH_PATH.write_text(json.dumps(saved, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"추적 관찰 {len(saved)}곳의 기준 상태를 저장했습니다: {WATCH_PATH}")
        return
    changed = []
    for case in cases:
        entry = saved.get(case["id"])
        if entry is None:
            continue
        state = seller_state(case)
        removed = case["id"] in args.removed
        entry["checks"].append({"checked_at": now, "state": state, "page_removed": removed})
        before = entry["baseline"]
        diffs = [f"{key}: {before.get(key)} → {state.get(key)}" for key in ("nts", "mail_order")
                 if before.get(key) != state.get(key)]
        if removed:
            diffs.append("판매 페이지 내려감")
        if diffs:
            changed.append(f"{case['id']} ({before.get('seller')}): " + ", ".join(diffs))
    WATCH_PATH.write_text(json.dumps(saved, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"추적 관찰 {len(saved)}곳 확인. 변화 {len(changed)}곳")
    print("\n".join(changed) or "사업자 상태가 바뀐 곳이 없습니다.")


if __name__ == "__main__":
    main()
