"""Seller business-registration check from the listing's seller disclosure.

Korean online sellers must show their business registration number; the National Tax Service
status API tells whether that number is active, suspended, closed, or unknown. An active number
means the business is registered, not that the seller is trustworthy.
"""
import os
import re
from urllib.parse import unquote, urlparse

import httpx

from mail_order_index import find_number
from schemas import UNKNOWN, SellerInfo, SellerVerification

NTS_STATUS_URL = "https://api.odcloud.kr/api/nts-businessman/v1/status"

_LABELS = {
    "business_name": r"상호\s*명?|회사\s*명",
    "representative": r"대표자(?:\s*명)?|대표\s*성명",
    "business_number": r"사업자\s*(?:등록)?\s*번호",
    "mail_order_number": r"통신\s*판매\s*업?\s*(?:신고\s*번호|신고|번호)",
    "address": r"사업장\s*(?:소재지|주소)|소재지",
}
_NEXT_LABEL = re.compile("|".join([*_LABELS.values(), r"고객\s*센터", r"e-?mail", r"이메일", r"전화\s*번호", r"연락처", r"사업자\s*정보\s*확인", r"사업자\s*구분"]), re.I)
_NUMBER = re.compile(rf"(?:{_LABELS['business_number']})\s*[:：]?\s*(\d{{3}})\s*-?\s*(\d{{2}})\s*-?\s*(\d{{5}})(?!\d)")
# Marketplace operators print their own registration in page footers; that is not the seller.
_OPERATORS = r"(?:네이버|쿠팡|십일번가|11번가|지마켓|G마켓|이베이코리아|에스에스지닷컴|롯데쇼핑|인터파크|위메프|티몬|카카오)"
_PLATFORM = re.compile(rf"{_OPERATORS}\s*(?:주식회사|㈜|\(주\))|(?:주식회사|㈜|\(주\))\s*{_OPERATORS}|NAVER\s*Corp|Coupang\s*Corp"
                       r"|통신판매\s*중개", re.I)
# Marketplaces check a seller's registration at sign-up and show the trade name and representative openly.
MARKETPLACES = ("naver.com", "coupang.com", "11st.co.kr", "gmarket.co.kr", "auction.co.kr", "ssg.com", "lotteon.com")
_PLATFORM_NUMBERS = {"2208162517", "1208800767", "8158101244"}


def is_valid_business_number(digits: str) -> bool:
    if not re.fullmatch(r"\d{10}", digits):
        return False
    numbers = [int(char) for char in digits]
    total = sum(number * weight for number, weight in zip(numbers, (1, 3, 7, 1, 3, 7, 1, 3, 5)))
    total += numbers[8] * 5 // 10
    return (10 - total % 10) % 10 == numbers[9]


def _field(window: str, key: str) -> str:
    match = re.search(rf"(?:{_LABELS[key]})\s*[:：]?\s*", window)
    if not match:
        return UNKNOWN
    value = window[match.end():match.end() + 120].split("\n")[0]
    if key == "mail_order_number":
        number = re.match(r"제?\s*\d{4}\s*-\s*[가-힣A-Za-z]+(?:\s*-\s*[가-힣A-Za-z]+)?\s*-\s*\d+\s*호?", value)
        return number.group().strip() if number else UNKNOWN
    cut = _NEXT_LABEL.search(value)
    value = value[:cut.start()] if cut else value
    # One-line pastes run straight into the description; a sentence break or a table cell break (tab) ends the field.
    value = re.split(r"\.\s|\s{2,}|\t", value)[0]
    value = value.strip(" \t|·,:：")
    return value[:80] if value else UNKNOWN


def extract_seller_info(text: str) -> SellerInfo | None:
    previous_end = 0
    for match in _NUMBER.finditer(text):
        digits = "".join(match.groups())
        # Look back only to the previous number, so an operator footer does not taint the next block.
        context = text[max(previous_end, match.start() - 160):match.start()]
        window = text[max(previous_end, match.start() - 300):match.end() + 300]
        previous_end = match.end()
        if digits in _PLATFORM_NUMBERS or _PLATFORM.search(context):
            continue
        return SellerInfo(
            business_name=_field(window, "business_name"),
            representative=_field(window, "representative"),
            business_number=f"{digits[:3]}-{digits[3:5]}-{digits[5:]}",
            mail_order_number=_field(window, "mail_order_number"),
            address=_field(window, "address"),
            quote=" ".join(window.split())[:400],
        )
    return None


def is_marketplace(page_url: str) -> bool:
    host = (urlparse(page_url).hostname or "").lower()
    return any(host == site or host.endswith("." + site) for site in MARKETPLACES)


def extract_listed_identity(text: str) -> SellerInfo | None:
    """Trade name and representative shown without a number (the number sits behind a verification step)."""
    for match in re.finditer(rf"(?:{_LABELS['business_name']})\s*[:：]?\s*", text):
        window = text[match.start():match.start() + 300]
        name, representative = _field(window, "business_name"), _field(window, "representative")
        if UNKNOWN in {name, representative} or _PLATFORM.search(window[:120]) or re.search(_OPERATORS, name):
            continue
        return SellerInfo(business_name=name, representative=representative, quote=" ".join(window.split())[:300])
    return None


def _find_listed(listed: SellerInfo) -> tuple[SellerInfo, str] | None:
    """Flattened page text runs a field into what follows, so the first few words are tried as well."""
    def prefixes(value: str) -> list[str]:
        words = value.split()
        return list(dict.fromkeys([value, *(" ".join(words[:size]) for size in (1, 2, 3) if size <= len(words))]))
    for name in prefixes(listed.business_name):
        for representative in prefixes(listed.representative):
            number = find_number(name, representative)
            if number:
                return listed.model_copy(update={"business_name": name, "representative": representative}), number
    return None


def verify_seller(text: str, page_url: str = "") -> SellerVerification:
    seller = extract_seller_info(text or "")
    listed = extract_listed_identity(text or "") if seller is None and is_marketplace(page_url) else None
    # With the FTC file indexed, a unique trade name and representative gives the number the page hides.
    found = _find_listed(listed) if listed is not None else None
    if found:
        seller, number = found
        seller = seller.model_copy(update={"business_number": f"{number[:3]}-{number[3:5]}-{number[5:]}"})
        return _check_number(seller).model_copy(update={"number_source": "registry"})
    if listed is not None:
        return SellerVerification(status="marketplace_listed", label="오픈마켓 표시 판매자", seller=listed,
                                  message="오픈마켓이 표시한 상호와 대표자를 확인했습니다. 사업자등록번호는 인증 뒤에만 보여 국세청 "
                                  "상태는 조회하지 못했습니다. 마켓의 입점 심사를 거친 판매자라는 뜻일 뿐 신뢰도를 보증하지 않습니다.")
    if seller is None:
        return SellerVerification(message="판매 자료에서 판매자의 사업자등록번호를 찾지 못했습니다. "
                                  "네이버·11번가는 '판매자 상세정보 확인'의 인증을 직접 마친 뒤 가져와야 번호가 보입니다.")
    return _check_number(seller)


def _check_number(seller: SellerInfo) -> SellerVerification:
    digits = seller.business_number.replace("-", "")
    if not is_valid_business_number(digits):
        return SellerVerification(status="invalid_number", label="번호 형식 오류", seller=seller,
                                  message="표시된 사업자등록번호의 검증 숫자가 맞지 않습니다. 오타이거나 실제 번호가 아닐 수 있어요.")
    key = os.getenv("DATA_GO_KR_SERVICE_KEY", "").strip()
    if not key:
        return SellerVerification(status="unavailable", label="조회 불가", seller=seller,
                                  message="국세청 사업자 상태조회 키가 설정되지 않아 등록 상태를 확인하지 못했습니다.")
    try:
        response = httpx.post(NTS_STATUS_URL, params={"serviceKey": unquote(key), "returnType": "JSON"},
                              json={"b_no": [digits]}, timeout=8.0)
        response.raise_for_status()
        record = response.json()["data"][0]
        code = record.get("b_stt_cd") or ""
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError, AttributeError):
        return SellerVerification(status="unavailable", label="조회 불가", seller=seller,
                                  message="국세청 사업자 상태조회에 실패했습니다. 잠시 후 다시 시도해 주세요.")
    tax_type = record.get("tax_type") or None
    if code == "01":
        return SellerVerification(status="active", label="계속사업자", seller=seller, tax_type=tax_type,
                                  message="국세청에 정상 등록된 사업자입니다. 등록 여부일 뿐 판매자의 신뢰도를 보증하지 않습니다.")
    if code == "02":
        return SellerVerification(status="suspended", label="휴업 중인 사업자", seller=seller, tax_type=tax_type,
                                  message="국세청에서 휴업 상태로 조회됩니다. 실제 판매·배송이 가능한지 판매자에게 확인해 주세요.")
    if code == "03":
        end = record.get("end_dt") or ""
        closed_on = f"{end[:4]}-{end[4:6]}-{end[6:]}" if re.fullmatch(r"\d{8}", end) else None
        return SellerVerification(status="closed", label="폐업한 사업자", seller=seller, tax_type=tax_type,
                                  closed_on=closed_on,
                                  message="국세청에서 폐업 상태로 조회됩니다"
                                  + (f"(폐업일 {closed_on})" if closed_on else "")
                                  + ". 폐업한 사업자 명의의 판매는 구매 전 반드시 확인이 필요합니다.")
    if code == "":
        return SellerVerification(status="unregistered", label="국세청 미등록 번호", seller=seller, tax_type=tax_type,
                                  message="표시된 사업자등록번호가 국세청에 등록되어 있지 않습니다. 실제 사업자 정보인지 확인이 필요합니다.")
    return SellerVerification(status="unavailable", label="조회 불가", seller=seller,
                              message="국세청 응답에서 사업자 상태를 확인하지 못했습니다.")
