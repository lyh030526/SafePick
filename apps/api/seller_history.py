"""A seller's past in the FTC 통신판매사업자 file: trade names used under the same business number, and registrations
of the same trade name and representative under other numbers that were closed.

Only those records are kept, in a small file that ships with the API (the full index stays local). Representatives
are stored as a hash of their normalized name, so the file holds no personal names.

    python seller_history.py build
"""
import hashlib
import re
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

from mail_order_index import INDEX_PATH, normalize_name
from schemas import SellerHistory

HISTORY_PATH = Path(__file__).with_name("seller_history.sqlite")
CLOSED = ("폐업처리", "직권말소", "직권취소")
# Two or more closed registrations of the same trade name and representative, then a new one: the pattern of a shop that
# closes after complaints and opens again under a fresh number.
SERIAL_CLOSURES = 2


def _hash(representative: str) -> str:
    return hashlib.sha256(normalize_name(representative).encode()).hexdigest()[:20] if normalize_name(representative) else ""


def build(index_path: Path = INDEX_PATH, history_path: Path = HISTORY_PATH) -> int:
    temporary = history_path.with_suffix(".building")
    temporary.unlink(missing_ok=True)
    with closing(sqlite3.connect(f"file:{index_path}?mode=ro", uri=True)) as source, \
            closing(sqlite3.connect(temporary)) as db, db:
        db.execute("CREATE TABLE history (number TEXT, name TEXT, rep TEXT, report TEXT, state TEXT)")
        renamed = source.execute(
            "SELECT number, name, representative, report, state FROM sellers WHERE number IN "
            "(SELECT number FROM sellers GROUP BY number HAVING COUNT(DISTINCT name) >= 2)")
        reopened = source.execute(
            "SELECT s.number, s.name, s.representative, s.report, s.state FROM sellers s JOIN "
            "(SELECT name, representative FROM sellers WHERE name != '' AND representative != '' GROUP BY name, representative "
            f"HAVING COUNT(DISTINCT number) >= 2 AND SUM(state IN {CLOSED}) >= 1) g "
            "ON s.name = g.name AND s.representative = g.representative")
        rows = {(number, name, _hash(rep), report, state) for cursor in (renamed, reopened)
                for number, name, rep, report, state in cursor}
        db.executemany("INSERT INTO history VALUES (?, ?, ?, ?, ?)", sorted(rows))
        db.execute("CREATE INDEX by_number ON history (number)")
        db.execute("CREATE INDEX by_owner ON history (name, rep)")
    temporary.replace(history_path)
    return len(rows)


def seller_history(number: str, name: str, representative: str, history_path: Path = HISTORY_PATH) -> SellerHistory | None:
    """What the FTC file says about this seller's past; None when there is nothing on record or no file."""
    number = re.sub(r"\D", "", number or "")
    if not history_path.exists() or len(number) != 10:
        return None
    key_name, key_rep = normalize_name(name), _hash(representative)
    with closing(sqlite3.connect(f"file:{history_path}?mode=ro", uri=True)) as db:
        names = [row[0] for row in db.execute("SELECT DISTINCT name FROM history WHERE number = ? AND name != ''", (number,))]
        # Closed reports under this very number (closed, then reported again) and under other numbers of the same owner.
        owner = (" OR (name = ? AND rep = ? AND rep != '')" if key_name and key_rep else "")
        records = list(db.execute(f"SELECT number, report, state FROM history WHERE number = ?{owner}",
                                  (number, key_name, key_rep) if owner else (number,)))
    other_names = [item for item in names if item != key_name]
    others = [record for record in records if record[0] != number]
    closed = len({(other, report) for other, report, state in records if state in CLOSED})
    if not other_names and not others and not closed:
        return None
    if closed >= SERIAL_CLOSURES:
        return SellerHistory(status="reopened", closed_numbers=closed, other_names=other_names[:5], label="폐업 후 다시 등록한 이력",
                             message=f"같은 상호·대표자로 등록했다가 폐업·말소된 사업자번호가 {closed}개 있고, 지금은 새 번호로 영업합니다. "
                                     "문제가 생긴 뒤 폐업하고 새로 등록하는 판매자에게서 보이는 형태라, 리뷰와 판매자 평가를 더 꼼꼼히 확인해 주세요.")
    if other_names:
        return SellerHistory(status="renamed", closed_numbers=closed, other_names=other_names[:5], label="상호 변경 이력",
                             message=f"같은 사업자번호로 다른 상호({', '.join(other_names[:3])})를 쓴 기록이 있습니다. 상호 변경은 흔한 일이지만, "
                                     "예전 상호로 남은 후기나 피해 사례가 있는지 검색해 보세요.")
    return SellerHistory(status="reopened_once" if closed else "other_numbers", closed_numbers=closed, other_names=[],
                         label="이전 사업자번호 이력",
                         message=(f"같은 상호·대표자로 폐업한 사업자번호가 {closed}개 있습니다. 사업 형태를 바꾸며 새로 등록하는 경우도 많아 "
                                  "이것만으로 위험하다고 보지 않습니다." if closed else
                                  "같은 상호·대표자로 등록한 다른 사업자번호가 있습니다."))


def with_history(seller):
    """The seller check with the FTC history of its business number, trade name and representative attached."""
    info = seller.seller
    history = seller_history(info.business_number, info.business_name, info.representative)
    return seller.model_copy(update={"history": history}) if history else seller


if __name__ == "__main__":
    if sys.argv[1:] != ["build"]:
        sys.exit(__doc__)
    print(f"판매자 이력 {build():,}건을 저장했습니다: {HISTORY_PATH}")
