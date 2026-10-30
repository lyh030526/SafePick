import os
from urllib.parse import urlparse

import httpx

from official_brands import OfficialBrand
from schemas import OfficialSearchResult


class OfficialSearchError(Exception):
    pass


def is_official_url(url: str, domains: tuple[str, ...]) -> bool:
    try:
        parsed = urlparse(url)
        if parsed.scheme not in {"https", "http"} or parsed.username or parsed.password:
            return False
        hostname = (parsed.hostname or "").casefold()
    except ValueError:
        return False
    return any(hostname == domain or hostname.endswith(f".{domain}") for domain in domains)


def search_official_pages(query: str, brand: OfficialBrand) -> list[OfficialSearchResult]:
    api_key = os.getenv("SERPER_API_KEY")
    if not api_key:
        raise OfficialSearchError("SERPER_API_KEY가 설정되지 않았습니다.")

    sites = [f"site:{site}" for site in (brand.search_sites or brand.domains)]
    # Serper returns nothing for a parenthesized single filter such as "(site:apple.com/kr)".
    site_filters = sites[0] if len(sites) == 1 else f"({' OR '.join(sites)})"
    try:
        response = httpx.post(
            "https://google.serper.dev/search",
            headers={"X-API-KEY": api_key},
            json={"q": f"{query} {site_filters}", "gl": "kr", "hl": "ko", "num": 5},
            timeout=12.0,
        )
        response.raise_for_status()
    except httpx.HTTPError as error:
        raise OfficialSearchError("공식 사이트 검색 요청에 실패했습니다.") from error

    try:
        payload = response.json()
        organic = payload.get("organic", [])
        if not isinstance(organic, list):
            raise ValueError("Invalid search results")
    except (ValueError, AttributeError) as error:
        raise OfficialSearchError("공식 검색 결과 형식을 확인할 수 없습니다.") from error
    results: list[OfficialSearchResult] = []
    for item in organic:
        if not isinstance(item, dict):
            continue
        url = item.get("link")
        title = item.get("title")
        if not isinstance(url, str) or not isinstance(title, str) or not is_official_url(url, brand.domains):
            continue
        results.append(
            OfficialSearchResult(
                title=title,
                url=url,
                snippet=item.get("snippet") if isinstance(item.get("snippet"), str) else "",
            )
        )
    return results
