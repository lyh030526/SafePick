"""Local index of the FTC 통신판매사업자 file, to find a business number from a trade name and representative.

Naver and 11st show the seller's trade name and representative openly but the number only after a verification step.
The FTC publishes every mail-order registration as region CSV files (data.go.kr 15083251, updated weekly); this module
loads them into SQLite and looks up the number only when exactly one operating business has that name and representative.

    python mail_order_index.py build <csv> [<csv> ...]
"""
import csv
import re
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

INDEX_PATH = Path(__file__).resolve().parents[2] / "data" / "mail_order" / "index.sqlite"
_COMPANY_FORMS = re.compile(r"주식회사|유한회사|합자회사|\(주\)|㈜|\(유\)|co\.?,?\s*ltd\.?|inc\.?|corp(oration)?\.?", re.I)
# Header names as the portal lists them; older files spell a few differently.
_COLUMNS = {"name": ("상호", "상호명", "사업자명"), "representative": ("대표자명", "대표자"),
            "number": ("사업자등록번호", "사업자번호"), "report": ("통신판매번호", "신고번호"),
            "state": ("업소상태", "영업상태"), "domain": ("인터넷도메인", "도메인")}


def normalize_name(value: str) -> str:
    return re.sub(r"[^0-9a-z가-힣]", "", _COMPANY_FORMS.sub("", value or "").lower())


def _rows(path: Path):
    # Some registrations carry very long item lists in one field.
    csv.field_size_limit(2**31 - 1)
    for encoding in ("utf-8-sig", "cp949"):
        try:
            with path.open(encoding=encoding, newline="") as handle:
                reader = csv.DictReader(handle)
                header = {name.strip(): name for name in reader.fieldnames or []}
                pick = {key: next((header[name] for name in names if name in header), None) for key, names in _COLUMNS.items()}
                if not pick["name"] or not pick["number"]:
                    raise ValueError(f"{path.name}: 상호·사업자등록번호 열을 찾지 못했습니다.")
                # An unquoted comma shifts the rest of a row into the wrong columns (about 4% of the Seoul file);
                # such a row could tie a trade name to the wrong number, so it is left out.
                yield from ({key: (row.get(column) or "").strip() if column else "" for key, column in pick.items()}
                            for row in reader if None not in row)
            return
        except UnicodeDecodeError:
            continue
    raise ValueError(f"{path.name}: UTF-8·CP949 어느 쪽으로도 읽지 못했습니다.")


def build(paths: list[Path], index_path: Path | None = None) -> int:
    index_path = index_path or INDEX_PATH
    index_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = index_path.with_suffix(".building")
    temporary.unlink(missing_ok=True)
    count = 0
    # The connection's own context manager only commits; closing releases the file on Windows.
    with closing(sqlite3.connect(temporary)) as db, db:
        db.execute("CREATE TABLE sellers (name TEXT, representative TEXT, number TEXT, report TEXT, state TEXT, domain TEXT)")
        for path in paths:
            batch = []
            for row in _rows(path):
                number = re.sub(r"\D", "", row["number"])
                if len(number) != 10:
                    continue
                batch.append((normalize_name(row["name"]), normalize_name(row["representative"]), number,
                              row["report"], row["state"], row["domain"]))
            db.executemany("INSERT INTO sellers VALUES (?, ?, ?, ?, ?, ?)", batch)
            count += len(batch)
        db.execute("CREATE INDEX by_name ON sellers (name, representative)")
    # Swap in the finished index at once, so a lookup never reads a half-built file.
    temporary.replace(index_path)
    return count


def find_number(name: str, representative: str, index_path: Path | None = None) -> str | None:
    """The business number when exactly one operating registration has this trade name and representative."""
    index_path = index_path or INDEX_PATH
    name, representative = normalize_name(name), normalize_name(representative)
    if not index_path.exists() or not name or not representative:
        return None
    with closing(sqlite3.connect(f"file:{index_path}?mode=ro", uri=True)) as db:
        numbers = {number for (number,) in db.execute(
            "SELECT number FROM sellers WHERE name = ? AND representative = ? AND state LIKE '%정상%'", (name, representative))}
    return numbers.pop() if len(numbers) == 1 else None


if __name__ == "__main__":
    if len(sys.argv) < 3 or sys.argv[1] != "build":
        sys.exit(__doc__)
    print(f"통신판매사업자 {build([Path(arg) for arg in sys.argv[2:]]):,}건으로 색인을 만들었습니다: {INDEX_PATH}")
