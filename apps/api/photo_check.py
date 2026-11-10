"""Where else the listing's main product photo appears, from Google Lens through Serper.

Resellers routinely use the brand's own photos and scam shops copy photos from honest sellers, so a photo found elsewhere
says nothing about this seller by itself. It is shown for reference, and it counts once: a listing that claims to sell
the genuine article with a photo that cheap overseas marketplaces sell under is a contradiction the claim check reports.
"""
import os
from urllib.parse import urlparse

import httpx

from domain_check import REPORTED, domain_flags, registrable_domain
from lookup_cache import cached
from official_brands import OFFICIAL_BRANDS
from schemas import PhotoCheck, PhotoMatch

LENS_URL = "https://google.serper.dev/lens"
# Marketplaces where unbranded and counterfeit goods sell cheaply, and second-hand markets.
OVERSEAS_CHEAP = ("aliexpress.com", "aliexpress.us", "temu.com", "taobao.com", "tmall.com", "1688.com", "alibaba.com",
                  "dhgate.com", "shein.com", "wish.com")
SECOND_HAND = ("bunjang.co.kr", "daangn.com", "joongna.com", "karrotmarket.com")
OFFICIAL = {domain for brand in OFFICIAL_BRANDS for domain in brand.domains}
# Enough of the matches on cheap overseas marketplaces that the photo is evidently theirs.
OVERSEAS_SHARE = 0.3
MIN_OVERSEAS = 3


def _kind(link: str) -> str:
    domain = registrable_domain((urlparse(link).hostname or "").lower())
    if domain in REPORTED or "impersonates" in domain_flags(link):
        return "reported"
    if any(domain == item or domain.endswith("." + item) for item in OVERSEAS_CHEAP):
        return "overseas_cheap"
    if domain in SECOND_HAND:
        return "second_hand"
    if domain in OFFICIAL:
        return "official"
    return "other"


def check_photo(image_url: str | None, page_url: str = "") -> PhotoCheck | None:
    if not image_url:
        return None
    key = os.getenv("SERPER_API_KEY", "").strip()
    if not key:
        return PhotoCheck(status="unavailable", label="사진 검색 안 함", message="이미지 검색 키가 설정되지 않아 사진을 찾지 않았습니다.")

    def fetch():
        response = httpx.post(LENS_URL, headers={"X-API-KEY": key}, json={"url": image_url, "gl": "kr", "hl": "ko"}, timeout=15.0)
        response.raise_for_status()
        items = response.json().get("organic", [])
        return items if isinstance(items, list) else []
    try:
        items = cached("lens", image_url, fetch)
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return PhotoCheck(status="unavailable", label="사진 검색 실패", message="같은 사진을 찾지 못했습니다. 잠시 후 다시 시도해 주세요.")
    own = registrable_domain((urlparse(page_url).hostname or "").lower())
    matches = []
    for item in items:
        link = str(item.get("link") or "") if isinstance(item, dict) else ""
        if not link.startswith("http") or registrable_domain((urlparse(link).hostname or "").lower()) == own:
            continue
        matches.append(PhotoMatch(title=str(item.get("title") or "")[:120], source=str(item.get("source") or "")[:60], link=link,
                                  kind=_kind(link)))
    if not matches:
        return PhotoCheck(status="none", label="다른 곳에서 찾지 못함", message="같은 사진을 쓴 다른 페이지를 찾지 못했습니다.")
    counts = {kind: sum(match.kind == kind for match in matches) for kind in ("reported", "overseas_cheap", "second_hand", "official")}
    # The ones worth a look first: reported sites, cheap overseas marketplaces, second-hand listings, the official site.
    order = {"reported": 0, "overseas_cheap": 1, "second_hand": 2, "official": 3, "other": 4}
    shown = sorted(matches, key=lambda match: order[match.kind])[:6]
    base = dict(matches=shown, match_count=len(matches), overseas_count=counts["overseas_cheap"])
    if counts["overseas_cheap"] >= MIN_OVERSEAS and counts["overseas_cheap"] >= len(matches) * OVERSEAS_SHARE:
        return PhotoCheck(status="overseas_cheap", label="해외 저가 마켓에서도 쓰는 사진", **base,
                          message=f"같은 사진이 알리익스프레스·테무 같은 해외 저가 마켓 {counts['overseas_cheap']}곳에서 쓰입니다. 국내에서 "
                                  "되파는 상품이거나 같은 공장 제품일 수 있으니, 정품이라는 설명이 있다면 근거를 확인해 주세요.")
    if counts["reported"]:
        return PhotoCheck(status="reported", label="사기 의심 사이트에서도 쓰는 사진", **base,
                          message="같은 사진을 사기 의심 사이트로 공지된 곳에서도 씁니다. 사기 사이트가 정상 판매처의 사진을 베끼는 일이 흔해 "
                                  "이것만으로 이 판매자를 의심하지는 않지만, 판매자 정보를 꼭 확인해 주세요.")
    if counts["official"]:
        return PhotoCheck(status="official", label="공식 사이트의 사진", **base,
                          message="브랜드 공식 사이트의 사진을 씁니다. 판매처가 공식 사진을 쓰는 것은 흔한 일이라 정품의 근거는 아닙니다.")
    return PhotoCheck(status="elsewhere", label=f"다른 페이지 {len(matches)}곳에서 쓰는 사진", **base,
                      message="같은 사진을 다른 판매처들도 씁니다. 같은 상품을 여러 곳에서 팔 때 흔한 일입니다.")
