"""Mail-order registration check: the seller shown on the page against the FTC 통신판매사업자 record.

The NTS status only says a number belongs to an operating business. A page can print another company's number, so
the FTC record of that number (trade name, 신고번호, registered domain) is compared with what the page shows.
"""
import os
import re
from urllib.parse import unquote, urlparse

import httpx

from mail_order_index import normalize_name as _name
from schemas import UNKNOWN, MailOrderCheck, SellerVerification
from seller_verification import is_marketplace

FTC_DETAIL_URL = "https://apis.data.go.kr/1130000/MllBsDtl_3Service/getMllBsInfoDetail_3"
_HOST = re.compile(r"(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _report_number(value: str) -> str:
    # "제2006-경기성남-0692호" and "2006-경기성남-0692" are the same report.
    return re.sub(r"[^0-9가-힣]", "", re.sub(r"^제|호$", "", (value or "").strip()))


def _site(host: str) -> str:
    """Registrable domain: store.sony.co.kr and www.sony.co.kr are both sony.co.kr."""
    labels = host.lower().removeprefix("www.").split(".")
    size = 3 if len(labels) >= 3 and labels[-1] == "kr" and labels[-2] in {"co", "or", "ne", "go", "ac", "re", "pe"} else 2
    return ".".join(labels[-size:])


def _known(value) -> str:
    text = str(value or "").strip()
    return "" if text in {"", "N/A", UNKNOWN} else text


def check_mail_order(verification: SellerVerification, page_url: str, text: str = "") -> MailOrderCheck | None:
    """None when there is no well-formed number to look up; the NTS result already explains that."""
    seller = verification.seller
    digits = seller.business_number.replace("-", "")
    if verification.status in {"not_found", "invalid_number"} or not re.fullmatch(r"\d{10}", digits):
        return None
    key = os.getenv("DATA_GO_KR_SERVICE_KEY", "").strip()
    if not key:
        return MailOrderCheck(message="공공데이터포털 키가 설정되지 않아 통신판매업 신고 정보를 확인하지 못했습니다.")
    try:
        response = httpx.get(FTC_DETAIL_URL, params={"serviceKey": unquote(key), "pageNo": 1, "numOfRows": 20,
                                                     "resultType": "json", "brno": digits}, timeout=8.0)
        response.raise_for_status()
        items = response.json().get("items") or []
        if not isinstance(items, list):
            raise ValueError
    except (httpx.HTTPError, ValueError, AttributeError):
        return MailOrderCheck(message="공정거래위원회 통신판매업 신고 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.")

    records = [item for item in items if isinstance(item, dict) and str(item.get("brno")) == digits]
    if not records:
        return MailOrderCheck(status="not_found", label="통신판매업 신고 없음",
                              message="이 사업자등록번호로 신고된 통신판매업 정보가 없습니다. 소규모 면제 사업자일 수도 있지만, "
                              "온라인 판매자라면 신고 여부를 확인해 주세요.")
    active = [item for item in records if _known(item.get("operSttusCdNm")) == "정상영업"]
    current = (active or records)[0]
    found = dict(registered_name=_known(current.get("bzmnNm")) or None,
                 registered_representative=_known(current.get("rprsvNm")) or None,
                 report_number=_known(current.get("prmmiMnno")) or None,
                 registered_domains=sorted({_site(host) for item in active
                                            for host in _HOST.findall(_known(item.get("domnCn")))}))
    if not active:
        return MailOrderCheck(status="closed", label="통신판매업 폐업·취소", **found,
                              message=f"신고된 통신판매업이 모두 '{_known(current.get('operSttusCdNm')) or '정상영업 아님'}' "
                              "상태입니다. 현재 온라인 판매를 신고한 사업자인지 확인이 필요합니다.")

    page_name = _name(seller.business_name) if seller.business_name != UNKNOWN else ""
    names = [_name(_known(item.get("bzmnNm"))) for item in active]
    name_ok = not page_name or any(name and (page_name in name or name in page_name) for name in names)
    # Without a 상호 label, the registered trade name must still appear somewhere on the page (e.g. a footer).
    named_on_page = bool(page_name) or any(name and name in _name(text) for name in names)
    page_report = _report_number(seller.mail_order_number) if seller.mail_order_number != UNKNOWN else ""
    report_ok = not page_report or any(page_report == _report_number(_known(item.get("prmmiMnno"))) for item in records)
    if not (name_ok and report_ok):
        shown = "상호" if not name_ok else "통신판매업 신고번호"
        return MailOrderCheck(status="mismatch", label="신고 정보와 다름", **found,
                              message=f"페이지의 {shown}가 이 사업자번호로 신고된 정보와 다릅니다. 다른 업체의 번호를 "
                              "적어 둔 것일 수 있으니 판매자에게 확인하기 전에는 구매를 미뤄 주세요.")

    # Sellers on marketplaces sell under the marketplace domain, so a registered domain is not compared.
    host = (urlparse(page_url).hostname or "").lower()
    own_mall = host and not is_marketplace(page_url)
    if own_mall and found["registered_domains"] and _site(host) not in found["registered_domains"]:
        return MailOrderCheck(status="domain_differs", label="신고 도메인과 다름", **found,
                              message=f"신고된 쇼핑몰 주소({', '.join(found['registered_domains'])})와 지금 페이지 주소({_site(host)})가 "
                              "다릅니다. 신고를 갱신하지 않았을 수도 있지만, 공식 쇼핑몰 주소인지 확인해 주세요.")
    if not named_on_page:
        return MailOrderCheck(status="name_absent", label="신고 상호가 페이지에 없음", **found,
                              message=f"이 번호로 신고된 상호({found['registered_name']})가 페이지 어디에도 보이지 않습니다. "
                              "판매자 정보를 펼쳐 다시 가져오거나, 판매자가 이 번호의 사업자인지 확인해 주세요.")
    return MailOrderCheck(status="matched", label="통신판매업 신고 일치", **found,
                          message="이 사업자번호로 정상 영업 중인 통신판매업 신고가 있고, 신고된 상호가 페이지의 판매자 정보와 "
                          "같습니다. 신고 여부일 뿐 판매자의 신뢰도를 보증하지 않습니다.")


def with_mail_order(verification: SellerVerification, page_url: str, text: str = "") -> SellerVerification:
    return verification.model_copy(update={"mail_order": check_mail_order(verification, page_url, text)})
