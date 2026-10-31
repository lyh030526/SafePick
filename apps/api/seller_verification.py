"""Seller business-registration check from the listing's seller disclosure.

Korean online sellers must show their business registration number; the National Tax Service
status API tells whether that number is active, suspended, closed, or unknown. An active number
means the business is registered, not that the seller is trustworthy.
"""
import os
import re
from urllib.parse import unquote

import httpx

from schemas import UNKNOWN, SellerInfo, SellerVerification

NTS_STATUS_URL = "https://api.odcloud.kr/api/nts-businessman/v1/status"

_LABELS = {
    "business_name": r"상호\s*명?|회사\s*명",
    "representative": r"대표자(?:\s*명)?|대표\s*성명",
    "business_number": r"사업자\s*(?:등록)?\s*번호",
    "mail_order_number": r"통신\s*판매\s*업?\s*(?:신고)?\s*번호",
    "address": r"사업장\s*(?:소재지|주소)|소재지",
}
_NEXT_LABEL = re.compile("|".join([*_LABELS.values(), r"고객\s*센터", r"e-?mail", r"이메일", r"전화\s*번호", r"연락처", r"사업자\s*정보\s*확인"]), re.I)
_NUMBER = re.compile(rf"(?:{_LABELS['business_number']})\s*[:：]?\s*(\d{{3}})\s*-?\s*(\d{{2}})\s*-?\s*(\d{{5}})(?!\d)")
# Marketplace operators print their own registration in page footers; that is not the seller.
_PLATFORM = re.compile(r"네이버\s*(?:주식회사|㈜|\(주\))|NAVER\s*Corp|쿠팡\s*(?:주식회사|㈜|\(주\))|Coupang\s*Corp", re.I)
_PLATFORM_NUMBERS = {"2208162517", "1208800767"}


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
    # One-line pastes run straight into the description; a sentence break ends the field.
    value = re.split(r"\.\s|\s{2,}", value)[0]
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


def verify_seller(text: str) -> SellerVerification:
    seller = extract_seller_info(text or "")
    if seller is None:
        return SellerVerification(message="판매 자료에서 판매자의 사업자등록번호를 찾지 못했습니다. "
                                  "상품 페이지의 '판매자 정보'나 반품·교환 안내를 펼친 뒤 다시 가져와 주세요.")
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
