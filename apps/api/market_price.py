"""Market price check: the sale price against other shops selling the same model.

Uses Google Shopping results through Serper (Korean market). Only listings whose title carries the same model number are
compared, so products without a model number are left undetermined rather than guessed.
"""
import html
import os
import re
from decimal import Decimal
from statistics import median

import httpx

from comparison import currency_code, parse_price
from schemas import UNKNOWN, MarketListing, MarketPrice, ProductDetails

SHOPPING_URL = "https://google.serper.dev/shopping"
MIN_MATCHES = 3
FAR_BELOW_PERCENT = 50
BELOW_PERCENT = 70
# Used, refurbished, rental, accessory, and bundle listings are not the same offer.
_EXCLUDED = ["중고", "리퍼", "전시", "반품", "렌탈", "대여", "케이스", "커버", "필름", "보호", "호환", "교체",
             "부품", "거치대", "스킨", "파우치", "이어팁", "스트랩", "세트", "묶음", "1+1", "2+1"]
# Second-hand and rental shops list used items or monthly fees under ordinary titles.
_USED_SOURCES = re.compile(r"번개장터|중고나라|당근|후루츠|헬로마켓|세컨웨어|렌탈|bunjang|joongna|fruitsfamily", re.I)


def _model_pattern(model: str) -> re.Pattern | None:
    chars = re.findall(r"[0-9A-Za-z]", model)
    if len(chars) < 4 or not any(char.isdigit() for char in chars):
        return None
    # Separators may differ between shops (WH-1000XM5, WH 1000XM5) but XM5 must not match XM50.
    return re.compile(r"(?<![0-9A-Za-z])" + r"[\s\-_/.]*".join(map(re.escape, chars)) + r"(?![0-9A-Za-z])", re.I)


def _won(amount: Decimal) -> str:
    return str(int(amount.quantize(Decimal("1"))))


def check_market_price(product: ProductDetails) -> MarketPrice:
    model = product.model_number.strip()
    pattern = _model_pattern(model) if model != UNKNOWN else None
    if pattern is None:
        return MarketPrice(status="no_model", label="시세 판단 보류",
                           message="모델명이 확인되지 않아 같은 상품의 시세를 찾지 않았습니다. 모델명을 입력하면 비교할 수 있어요.")
    currency = currency_code(product.currency)
    if currency not in {None, "KRW"}:
        return MarketPrice(message="원화 가격만 국내 쇼핑 시세와 비교합니다.")
    key = os.getenv("SERPER_API_KEY", "").strip()
    brand = product.brand_name.strip()
    query = f"{brand} {model}" if brand and brand != UNKNOWN else model
    if not key:
        return MarketPrice(query=query, message="쇼핑 검색 키가 설정되지 않아 시세를 확인하지 못했습니다.")
    try:
        response = httpx.post(SHOPPING_URL, headers={"X-API-KEY": key},
                              json={"q": query, "gl": "kr", "hl": "ko", "num": 40}, timeout=10.0)
        response.raise_for_status()
        items = response.json()["shopping"]
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return MarketPrice(query=query, message="쇼핑 시세 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.")

    # A word in the product's own name (a case sold as a case) does not exclude its matches.
    own_name = f"{product.product_name} {model}"
    excluded = [word for word in _EXCLUDED if word not in own_name]
    matches, seen = [], set()
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        title = html.unescape(str(item.get("title", "")))
        source = str(item.get("source") or "판매처 미상")
        raw_price = str(item.get("price", "")).strip()
        # Only single won prices; foreign-currency and ranged offers are not the domestic market.
        price = parse_price(raw_price) if raw_price.startswith("₩") else None
        seen_key = item.get("productId") or (title, source, raw_price)
        if (price is None or seen_key in seen or _USED_SOURCES.search(source) or not pattern.search(title)
                or any(word in title for word in excluded)):
            continue
        seen.add(seen_key)
        matches.append(MarketListing(title=title[:120], mall=source, price=_won(price), link=str(item.get("link") or "")))
    # Monthly fees, parts, and multipacks that slip past the filters sit far from the rest.
    if matches:
        rough = Decimal(median(Decimal(item.price) for item in matches))
        matches = [item for item in matches if rough * Decimal("0.3") <= Decimal(item.price) <= rough * 3]
    if len(matches) < MIN_MATCHES:
        return MarketPrice(status="insufficient", label="시세 판단 보류", query=query, match_count=len(matches),
                           listings=matches[:3],
                           message=f"같은 모델의 새 상품 판매처를 {len(matches)}곳만 찾아 시세를 계산하지 않았습니다.")

    prices = sorted(Decimal(item.price) for item in matches)
    middle = Decimal(median(prices))
    market = dict(query=query, median_price=_won(middle), min_price=_won(prices[0]), max_price=_won(prices[-1]),
                  match_count=len(matches), listings=sorted(matches, key=lambda item: Decimal(item.price))[:3])
    sale = parse_price(product.price)
    if sale is None:
        return MarketPrice(status="no_price", label="시세 판단 보류", **market,
                           message="같은 모델의 시세는 찾았지만 판매 가격이 확인되지 않아 비교하지 않았습니다.")
    # Truncated, so the shown percent never sits on the other side of a threshold.
    ratio = int(sale * 100 / middle)
    if ratio < FAR_BELOW_PERCENT:
        status, label = "far_below", "시세보다 지나치게 저렴"
        message = (f"판매가가 같은 모델 시세 중앙값의 {ratio}%입니다. 가품·미끼 가격·구성품 차이일 수 있으니 "
                   "판매자와 상품 구성을 꼭 확인해 주세요.")
    elif ratio < BELOW_PERCENT:
        status, label = "below", "시세보다 저렴"
        message = f"판매가가 같은 모델 시세 중앙값의 {ratio}%입니다. 할인 사유와 구성품이 같은지 확인해 주세요."
    else:
        status, label = "typical", "시세 범위"
        message = f"판매가가 같은 모델 시세 중앙값의 {ratio}%로, 지나치게 저렴하지 않습니다."
    return MarketPrice(status=status, label=label, message=message, sale_price=_won(sale), ratio_percent=ratio, **market)
