"""Finding a brand's official site when it is not one of the curated brands.

Small makers and most brands are not in OFFICIAL_BRANDS, so the official comparison had nothing to compare. The site is
looked up by the brand name: Google's knowledge panel website first, then a top result that calls itself the brand's
official site. Lookalikes are the risk, so marketplaces, portals, and social sites never count, nor does a reported
scam domain or a domain that imitates a well-known brand. The shop being analyzed counts as the official site only
when the knowledge panel names it, so a scam shop cannot vouch for itself by calling itself official.
"""
import os
import re
from urllib.parse import urlparse

import httpx

from domain_check import BRANDS, REPORTED, domain_flags, registrable_domain
from lookup_cache import cached
from official_brands import OfficialBrand

SEARCH_URL = "https://google.serper.dev/search"
# Places that list a brand without being it.
_NOT_OFFICIAL = (
    "coupang.com", "naver.com", "11st.co.kr", "gmarket.co.kr", "auction.co.kr", "ssg.com", "lotteon.com", "kakao.com",
    "daum.net", "tmon.co.kr", "wemakeprice.com", "interpark.com", "musinsa.com", "29cm.co.kr", "oliveyoung.co.kr",
    "kurly.com", "danawa.com", "enuri.com", "amazon.com", "aliexpress.com", "temu.com", "ebay.com", "rakuten.co.jp",
    "wikipedia.org", "namu.wiki", "youtube.com", "instagram.com", "facebook.com", "x.com", "twitter.com", "tiktok.com",
    "linkedin.com", "tistory.com", "blogspot.com", "brunch.co.kr", "google.com", "jobkorea.co.kr", "saramin.co.kr",
    "catch.co.kr", "wanted.co.kr", "kiprislab.com", "kipris.or.kr", "nicebizinfo.com", "bizno.net", "dart.fss.or.kr",
    "smartstore.naver.com", "brand.naver.com", "cafe24.com", "imweb.me", "sixshop.com", "modoo.at",
)
_OFFICIAL_WORDS = re.compile(r"공식|official|브랜드\s*사이트|홈페이지|homepage", re.I)


def _norm(text: str) -> str:
    return re.sub(r"[\s()\[\]㈜·\-_.]|주식회사|\(주\)|유한회사|코리아|korea", "", text.lower())


def _usable(url: str, own_domain: str) -> str | None:
    host = (urlparse(url).hostname or "").lower()
    if not host:
        return None
    domain = registrable_domain(host)
    if any(domain == site or host == site or host.endswith("." + site) for site in _NOT_OFFICIAL):
        return None
    if domain in REPORTED or domain_flags(url).get("impersonates"):
        return None
    return None if domain == own_domain else domain


def _known(brand: str) -> OfficialBrand | None:
    """Brands whose official domains are already listed for lookalike detection need no search."""
    key = _norm(brand)
    for name, (_pattern, domains) in BRANDS.items():
        # 나이키 or Nike (nike.com)
        if key and (key == _norm(name) or any(key == domain.split(".")[0].replace("-", "") for domain in domains)):
            return OfficialBrand(name, domains, ())
    return None


def discover_official_brand(brand: str, page_url: str = "") -> OfficialBrand | None:
    brand = brand.strip()
    if not brand or brand == "확인 불가" or len(_norm(brand)) < 2:
        return None
    known = _known(brand)
    if known:
        return known
    key = os.getenv("SERPER_API_KEY", "").strip()
    if not key:
        return None

    def fetch():
        response = httpx.post(SEARCH_URL, headers={"X-API-KEY": key},
                              json={"q": f"{brand} 공식 홈페이지", "gl": "kr", "hl": "ko", "num": 10}, timeout=10.0)
        response.raise_for_status()
        return response.json()
    try:
        payload = cached("official_site", brand, fetch)
    except (httpx.HTTPError, ValueError):
        return None
    own = registrable_domain((urlparse(page_url).hostname or "").lower()) if page_url else ""
    name = _norm(brand)
    graph = payload.get("knowledgeGraph") if isinstance(payload, dict) else None
    if isinstance(graph, dict) and isinstance(graph.get("website"), str) and name in _norm(str(graph.get("title", ""))):
        # The knowledge panel is Google's own record of the brand, so it may name the shop being analyzed.
        domain = _usable(graph["website"], "")
        if domain:
            return OfficialBrand(brand, (domain,), ())
    organic = payload.get("organic", []) if isinstance(payload, dict) else []
    for item in organic[:5] if isinstance(organic, list) else []:
        if not isinstance(item, dict) or not isinstance(item.get("link"), str):
            continue
        title, snippet = str(item.get("title", "")), str(item.get("snippet", ""))
        if name not in _norm(title) or not _OFFICIAL_WORDS.search(f"{title} {snippet}"):
            continue
        domain = _usable(item["link"], own)
        if domain:
            return OfficialBrand(brand, (domain,), ())
    return None
