"""Domain registration check: a sign of risk only, never evidence of safety.

Shops the Seoul e-commerce center reported in 2026 were all registered months before the notice, for exactly one year,
and abandoned ones expire into a redemption period. An old domain says nothing about the seller (marketplace sellers
all sit on naver.com, aged domains are bought and good sites get hacked), so it earns no credit.
"""
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx

from schemas import DomainCheck
from seller_verification import is_marketplace

BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json"
NEW_DAYS = 365
VERY_NEW_DAYS = 180
SHORT_TERM_DAYS = 366
_DAY = 86400
_bootstrap: dict[str, str] = {}
_cache: dict[str, tuple[float, DomainCheck]] = {}


def registrable_domain(host: str) -> str:
    """store.sony.co.kr and www.sony.co.kr are both sony.co.kr."""
    labels = host.lower().removeprefix("www.").split(".")
    size = 3 if len(labels) >= 3 and labels[-1] == "kr" and labels[-2] in {"co", "or", "ne", "go", "ac", "re", "pe"} else 2
    return ".".join(labels[-size:])


def _rdap_base(tld: str) -> str | None:
    if not _bootstrap:
        services = httpx.get(BOOTSTRAP_URL, timeout=10.0).json()["services"]
        _bootstrap.update({name: urls[0] for names, urls in services for name in names})
    return _bootstrap.get(tld)


def _date(value: str | None) -> datetime | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None
    except ValueError:
        return None


def _lookup(domain: str, now: datetime) -> DomainCheck:
    base = _rdap_base(domain.rsplit(".", 1)[-1])
    if not base:
        return DomainCheck(domain=domain, message="이 도메인의 등록 정보를 조회할 곳이 없습니다.")
    response = httpx.get(base.rstrip("/") + f"/domain/{domain}", timeout=10.0, follow_redirects=True)
    if response.status_code == 404:
        return DomainCheck(status="missing", label="등록되지 않은 도메인", domain=domain,
                           message="이 주소의 도메인이 현재 등록되어 있지 않습니다. 사이트가 이미 사라졌거나 주소가 잘못되었습니다. "
                           "이 주소로는 결제하지 마세요.")
    response.raise_for_status()
    record = response.json()
    events = {event.get("eventAction"): _date(event.get("eventDate")) for event in record.get("events", [])}
    registered, expires = events.get("registration"), events.get("expiration")
    statuses = " ".join(record.get("status", [])).lower()
    found = dict(domain=domain, registered_on=registered.date().isoformat() if registered else None,
                 expires_on=expires.date().isoformat() if expires else None)
    if "redemption" in statuses or "pending delete" in statuses or (expires and expires < now):
        return DomainCheck(status="expired", label="만료된 도메인", **found,
                           message="도메인 등록 기간이 끝나 삭제를 기다리는 상태입니다. 운영을 그만둔 사이트일 가능성이 높으니 "
                           "이 주소로는 결제하지 마세요.")
    if not registered:
        return DomainCheck(**found, message="도메인 등록일을 확인하지 못했습니다.")
    age = (now - registered).days
    term = (expires - registered).days if expires else None
    found["age_days"] = age
    if age < VERY_NEW_DAYS and term is not None and term <= SHORT_TERM_DAYS:
        return DomainCheck(status="new_short", label="최근 1년 단기 등록", **found,
                           message=f"등록한 지 {age}일 된 도메인을 1년만 등록했습니다. 서울시가 공표한 사기 쇼핑몰에서 흔한 형태입니다. "
                           "신규 쇼핑몰일 수도 있으니 판매자 정보와 결제 수단을 꼭 확인해 주세요.")
    if age < NEW_DAYS:
        return DomainCheck(status="new", label="신규 도메인", **found,
                           message=f"등록한 지 {age}일 된 도메인입니다. 운영 기간이 짧아 판매자 정보를 더 확인할 필요가 있습니다.")
    return DomainCheck(status="established", label="오래된 도메인", **found,
                       message=f"등록한 지 {age // 365}년이 넘은 도메인입니다. 도메인이 오래되었다고 판매자를 믿을 수 있는 것은 아니며, "
                       "안전의 근거로 쓰지 않습니다.")


def check_domain(page_url: str, now: datetime | None = None) -> DomainCheck:
    host = (urlparse(page_url).hostname or "").lower()
    if not host or is_marketplace(page_url):
        return DomainCheck(status="marketplace", label="오픈마켓", domain=registrable_domain(host) if host else None,
                           message="오픈마켓 판매자는 마켓의 도메인을 쓰므로 도메인 등록 정보로 판단하지 않습니다.")
    domain = registrable_domain(host)
    now = now or datetime.now(timezone.utc)
    cached = _cache.get(domain)
    if cached and time.time() - cached[0] < _DAY:
        return cached[1]
    try:
        result = _lookup(domain, now)
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return DomainCheck(domain=domain, message="도메인 등록 정보 조회에 실패했습니다. 이것만으로 위험하다고 보지 않습니다.")
    if result.status != "unavailable":
        _cache[domain] = (time.time(), result)
    return result
