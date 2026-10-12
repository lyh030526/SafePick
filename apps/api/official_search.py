import os
from urllib.parse import urlparse

import httpx

from official_brands import OfficialBrand
from schemas import OfficialSearchResult


class OfficialSearchError(Exception):
    pass


def is_official_url(url: str, domains: tuple[str, ...]) -> bool:
    hostname = (urlparse(url).hostname or "").casefold()
    return any(hostname == domain or hostname.endswith(f".{domain}") for domain in domains)


def search_official_pages(query: str, brand: OfficialBrand) -> list[OfficialSearchResult]:
    api_key = os.getenv("SERPER_API_KEY")
    if not api_key:
        raise OfficialSearchError("SERPER_API_KEY가 설정되지 않았습니다.")

    site_filters = " OR ".join(f"site:{domain}" for domain in brand.domains)
    try:
        response = httpx.post(
            "https://google.serper.dev/search",
            headers={"X-API-KEY": api_key},
            json={"q": f"{query} ({site_filters})", "gl": "kr", "hl": "ko", "num": 5},
            timeout=12.0,
        )
        response.raise_for_status()
    except httpx.HTTPError as error:
        raise OfficialSearchError("공식 사이트 검색 요청에 실패했습니다.") from error

    organic = response.json().get("organic", [])
    results: list[OfficialSearchResult] = []
    for item in organic:
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
