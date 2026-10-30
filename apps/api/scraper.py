import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup


MAX_HTML_BYTES = 2_000_000
MAX_TEXT_LENGTH = 12_000
REQUEST_HEADERS = {
    "User-Agent": "SafePickMVP/0.1 (+https://github.com/lyh030526/SafePick)",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
}


class ProductPageError(ValueError):
    def __init__(self, message: str, fallback_allowed: bool = True):
        super().__init__(message)
        self.fallback_allowed = fallback_allowed


@dataclass
class ProductPage:
    final_url: str
    title: str
    text: str


def _validate_public_url(url: str, allowed_domains: tuple[str, ...] | None = None) -> str:
    """Return a validated public IP so the connection cannot be re-resolved (DNS rebinding)."""
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ProductPageError("http 또는 https 상품 링크만 분석할 수 있습니다.", fallback_allowed=False)
    if parsed.username or parsed.password:
        raise ProductPageError("인증 정보가 포함된 링크는 분석할 수 없습니다.", fallback_allowed=False)
    if allowed_domains is not None and not any(
        parsed.hostname == domain or parsed.hostname.endswith(f".{domain}") for domain in allowed_domains
    ):
        raise ProductPageError("공식 도메인 밖으로 이동하는 페이지는 읽지 않습니다.", fallback_allowed=False)

    try:
        addresses = socket.getaddrinfo(parsed.hostname, None, type=socket.SOCK_STREAM)
    except socket.gaierror as error:
        raise ProductPageError("상품 페이지 주소를 찾을 수 없습니다.") from error

    ips = [ipaddress.ip_address(address[4][0]) for address in addresses]
    if not ips or any(not ip.is_global for ip in ips):
        raise ProductPageError("공개 인터넷 주소만 분석할 수 있습니다.", fallback_allowed=False)
    return str(ips[0])


def _pinned_request(client: httpx.Client, url: str, ip: str) -> httpx.Request:
    # Connect to the validated IP while keeping Host, SNI and certificate checks on the hostname.
    target = httpx.URL(url)
    extensions = {"sni_hostname": target.host} if target.scheme == "https" else {}
    return client.build_request(
        "GET", target.copy_with(host=ip), headers={"Host": target.netloc.decode("ascii")}, extensions=extensions,
    )


def _read_html(response: httpx.Response) -> str:
    content_type = response.headers.get("content-type", "")
    if "html" not in content_type.lower():
        raise ProductPageError("HTML 상품 페이지만 분석할 수 있습니다.")

    declared_size = response.headers.get("content-length")
    if declared_size and declared_size.isdigit() and int(declared_size) > MAX_HTML_BYTES:
        raise ProductPageError("상품 페이지의 크기가 너무 커서 분석할 수 없습니다.")

    chunks: list[bytes] = []
    total_size = 0
    for chunk in response.iter_bytes():
        total_size += len(chunk)
        if total_size > MAX_HTML_BYTES:
            raise ProductPageError("상품 페이지의 크기가 너무 커서 분석할 수 없습니다.")
        chunks.append(chunk)

    return b"".join(chunks).decode(response.encoding or "utf-8", errors="replace")


def _extract_visible_text(html: str) -> tuple[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    for element in soup(["script", "style", "noscript", "svg", "iframe"]):
        element.decompose()

    title = soup.title.get_text(" ", strip=True) if soup.title else "확인 불가"
    text = " ".join(soup.stripped_strings)
    return title[:300], text[:MAX_TEXT_LENGTH]


def fetch_product_page(url: str, allowed_domains: tuple[str, ...] | None = None) -> ProductPage:
    current_url = url

    with httpx.Client(timeout=12.0, headers=REQUEST_HEADERS, follow_redirects=False) as client:
        for _ in range(4):
            ip = _validate_public_url(current_url, allowed_domains)
            try:
                response = client.send(_pinned_request(client, current_url, ip), stream=True)
            except httpx.TimeoutException as error:
                raise ProductPageError("판매 페이지 응답 시간이 초과되었습니다.") from error
            except httpx.HTTPError as error:
                raise ProductPageError("판매 페이지에 연결하지 못했습니다.") from error
            try:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        raise ProductPageError("상품 페이지의 이동 주소를 확인할 수 없습니다.")
                    current_url = str(httpx.URL(current_url).join(location))
                    continue
                if response.status_code >= 400:
                    raise ProductPageError(f"상품 페이지를 가져오지 못했습니다. ({response.status_code})")
                html = _read_html(response)
                title, text = _extract_visible_text(html)
                if not text:
                    raise ProductPageError("판매 페이지에서 읽을 수 있는 상품 정보를 찾지 못했습니다.")
                return ProductPage(final_url=current_url, title=title, text=text)
            except httpx.TimeoutException as error:
                raise ProductPageError("판매 페이지 응답 시간이 초과되었습니다.") from error
            except httpx.HTTPError as error:
                raise ProductPageError("판매 페이지를 끝까지 읽지 못했습니다.") from error
            finally:
                response.close()

    raise ProductPageError("상품 페이지가 너무 많이 이동되어 분석할 수 없습니다.")
