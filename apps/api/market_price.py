"""Market price check: the sale price against other shops selling the same model.

Uses Google Shopping results through Serper (Korean market). Only listings of the same product are compared: the same
model code, or the same brand and name. A product found at only one or two other shops, as small makers' products often
are, gets those prices as a reference that does not count toward the verdict.
"""
import html
import os
import re
from datetime import date
from decimal import Decimal
from statistics import median

import httpx

from lookup_cache import cached

from comparison import currency_code, parse_price
from schemas import UNKNOWN, MarketListing, MarketPrice, ProductDetails

SHOPPING_URL = "https://google.serper.dev/shopping"
MIN_MATCHES = 3
# A product matched by name alone, with no number in it, may be a different size or edition at another shop; the same
# product's prices sit close together, so a spread wider than this makes the comparison a reference only.
NAME_ONLY_SPREAD = 2
FAR_BELOW_PERCENT = 50
BELOW_PERCENT = 70
# Used, refurbished, rental, accessory, and bundle listings are not the same offer.
_EXCLUDED = ["중고", "리퍼", "전시", "반품", "렌탈", "대여", "케이스", "커버", "필름", "보호", "호환", "교체",
             "부품", "거치대", "스킨", "파우치", "이어팁", "이어패드", "쿠션", "스트랩", "케이블", "충전기", "세트", "묶음", "1+1", "2+1"]
# Second-hand and rental shops list used items or monthly fees under ordinary titles.
_USED_SOURCES = re.compile(r"번개장터|중고나라|당근|후루츠|헬로마켓|세컨웨어|렌탈|bunjang|joongna|fruitsfamily", re.I)


def _model_pattern(model: str, brand: str = "") -> re.Pattern | None:
    chars = re.findall(r"[0-9A-Za-z]", model)
    # Small makers use short codes (Y-07); three characters are too common to match alone, so the brand must be known
    # and appear in the title too.
    short = len(chars) == 3 and any(char.isalpha() for char in chars)
    if len(chars) < 4 and not (short and brand) or not any(char.isdigit() for char in chars):
        return None
    # Separators may differ between shops (WH-1000XM5, WH 1000XM5) but XM5 must not match XM50.
    code = r"(?<![0-9A-Za-z])" + r"[\s\-_/.]*".join(map(re.escape, chars)) + r"(?![0-9A-Za-z])"
    return re.compile(rf"(?=.*{re.escape(brand)}).*{code}" if short else code, re.I)


def rate_ratio(ratio: int, far_below: int = FAR_BELOW_PERCENT, below: int = BELOW_PERCENT) -> tuple[str, str, str]:
    """Status, label, and message for a sale price at `ratio` percent of the market median."""
    if ratio < far_below:
        return ("far_below", "시세보다 지나치게 저렴",
                f"판매가가 같은 모델 시세 중앙값의 {ratio}%입니다. 가품·미끼 가격·구성품 차이일 수 있으니 "
                "판매자와 상품 구성을 꼭 확인해 주세요.")
    if ratio < below:
        return ("below", "시세보다 저렴",
                f"판매가가 같은 모델 시세 중앙값의 {ratio}%입니다. 할인 사유와 구성품이 같은지 확인해 주세요.")
    return "typical", "시세 범위", f"판매가가 같은 모델 시세 중앙값의 {ratio}%로, 지나치게 저렴하지 않습니다."


def _won(amount: Decimal) -> str:
    return str(int(amount.quantize(Decimal("1"))))


# Tier words decide which product a name is (버즈6 플레이 vs 버즈6 라이트), so they must agree exactly.
_TIERS = {"프로", "플러스", "울트라", "맥스", "미니", "라이트", "플레이", "액티브", "에어", "엣지", "폴드", "플립", "슬림",
          "pro", "plus", "ultra", "max", "mini", "lite", "play", "active", "air", "edge", "fold", "flip", "slim", "se", "fe"}


# Words that say what kind of product it is, not which one: a name made only of them ("무선 블루투스 이어폰") is not one product.
_GENERIC = {"무선", "유선", "블루투스", "이어폰", "헤드폰", "헤드셋", "이어버드", "노이즈", "캔슬링", "스피커", "충전", "고속", "휴대용",
            "운동화", "신발", "스니커즈", "런닝화", "슬리퍼", "샌들", "남성", "여성", "남성용", "여성용", "남녀공용", "아동", "키즈",
            "향수", "지갑", "반지갑", "장지갑", "카드지갑", "가방", "백팩", "정품", "국내", "국내정품", "신상", "신형", "최신",
            "공식", "선물", "선물포장", "가정용", "업소용", "대용량", "미니", "블랙", "화이트", "그레이", "네이비", "베이지", "멀티",
            "스타일러", "드라이어", "청소기", "가습기", "선풍기", "전기", "자동", "스마트", "프리미엄", "데일리", "세트", "케이스"}


def _name_pattern(name: str, brand: str = ""):
    """A matcher for listings of the same named product when its model code is not in shop titles ("레드미 버즈 6
    플레이" for M2420E1), the matcher's query, and whether the name has a number. With a number, every number and
    nearly every word must appear; without one ("다이슨 에어랩 멀티 스타일러"), every word must, and at least three
    besides the brand, one of them more than a kind of product. Every title must carry the brand, so another company's look-alike is not taken for the same
    product; a name without a brand, or too few words ("무선 블루투스 이어폰"), is too generic to compare."""
    # Shops write "버즈6" and "버즈 6" alike, so letters and numbers are split apart on both sides.
    split = lambda text: re.sub(r"(?<=[가-힣a-z])(?=\d)|(?<=\d)(?=[가-힣a-z])", " ", text.lower())
    name = split(re.sub(r"\([^)]*\)|\[[^\]]*\]|,.*$", " ", name or ""))
    words = [word.lower() for word in re.findall(r"[0-9A-Za-z가-힣]+", name) if len(word) >= 2 or word.isdigit()][:7]
    numbers = [word for word in words if any(char.isdigit() for char in word)]
    own = [word for word in words if word not in brand.lower() and brand.lower() not in word]
    if not brand or len(words) < 2 or not numbers and (len(own) < 3 or not set(own) - _GENERIC):
        return None, "", False
    share = 0.8 if numbers else 1

    def matches(title: str) -> bool:
        title = split(title)
        tokens = set(re.findall(r"[0-9a-z가-힣]+", title))
        return (brand.lower() in title and all(number in tokens for number in numbers)
                and tokens & _TIERS == set(words) & _TIERS
                and sum(word in title for word in words) >= len(words) * share)
    return matches, " ".join(words), bool(numbers)


def _search(key: str, query: str) -> list:
    def fetch():
        response = httpx.post(SHOPPING_URL, headers={"X-API-KEY": key}, json={"q": query, "gl": "kr", "hl": "ko", "num": 40},
                              timeout=10.0)
        response.raise_for_status()
        items = response.json()["shopping"]
        return items if isinstance(items, list) else []
    return cached("shopping", query, fetch)


def _collect(items: list, matches_title, product: ProductDetails) -> list[MarketListing]:
    # A word in the product's own name (a case sold as a case) does not exclude its matches, and then only listings
    # sharing one of those words count, so replacement ear pads are not measured against the headphones they fit.
    own_name = f"{product.product_name} {product.model_number}"
    excluded = [word for word in _EXCLUDED if word not in own_name]
    required = [word for word in _EXCLUDED if word in own_name]
    matches, seen = [], set()
    for item in items:
        if not isinstance(item, dict):
            continue
        title = html.unescape(str(item.get("title", "")))
        source = str(item.get("source") or "판매처 미상")
        raw_price = str(item.get("price", "")).strip()
        # Only single won prices; foreign-currency and ranged offers are not the domestic market.
        price = parse_price(raw_price) if raw_price.startswith("₩") else None
        seen_key = item.get("productId") or (title, source, raw_price)
        if (price is None or seen_key in seen or _USED_SOURCES.search(source) or not matches_title(title)
                or any(word in title for word in excluded) or (required and not any(word in title for word in required))):
            continue
        seen.add(seen_key)
        matches.append(MarketListing(title=title[:120], mall=source, price=_won(price), link=str(item.get("link") or "")))
    # Monthly fees, parts, and multipacks that slip past the filters sit far from the rest.
    if matches:
        rough = Decimal(median(Decimal(item.price) for item in matches))
        matches = [item for item in matches if rough * Decimal("0.3") <= Decimal(item.price) <= rough * 3]
    return matches


# The shown price is a bait when even the cheapest option of the product itself costs this many times more: the listing
# leads with an accessory's or a gift's price and the product is only sold through the options.
BAIT_MULTIPLE = 2


def option_bait(product: ProductDetails) -> tuple[Decimal, str] | None:
    """The cheapest price of the product itself and a note, when the shown price is not what the product costs."""
    # The headline price before an option is chosen is the one a bait leads with; the extracted sale price may already
    # be the option's.
    shown = product.offer.display_price
    sale = parse_price(shown if shown != UNKNOWN else product.price)
    if sale is None or sale <= 0:
        return None
    totals = []
    for option in product.options:
        if option.kind != "main" or option.price in {"", UNKNOWN}:
            continue
        # "+0" is the shown price itself, which the price parser (positive amounts only) would skip.
        amount = Decimal(0) if re.fullmatch(r"\+0+", option.price) else parse_price(option.price.lstrip("+"))
        if amount is None:
            continue
        totals.append(sale + amount if option.price.startswith("+") else amount)
    if not totals or min(totals) < sale * BAIT_MULTIPLE:
        return None
    cheapest = min(totals)
    note = (f"대표 가격 {_won(sale)}원은 상품 옵션 최저가 {_won(cheapest)}원의 {int(sale * 100 / cheapest)}%입니다. "
            "싼 대표 가격은 부속품·사은품 옵션의 가격일 수 있으니, 실제로 고르는 옵션의 결제 금액을 확인해 주세요.")
    return cheapest, note


# A list price this far above the market median is not a price anyone charges, so the discount from it is inflated.
INFLATED_LIST_MULTIPLE = Decimal("1.5")
# A deadline this close on a discount this large is shown as pressure to decide, not as a finding.
SOON_DAYS = 3
BIG_DISCOUNT = 50


def discount_notes(product: ProductDetails, market: MarketPrice, today: date) -> dict:
    """What the page's list price and discount deadline say, against the market and today's date."""
    offer, update = product.offer, {}
    listed = parse_price(offer.list_price) if offer.list_price != UNKNOWN else None
    if listed is not None and market.status in {"typical", "below", "far_below"} and market.median_price and listed >= Decimal(market.median_price) * INFLATED_LIST_MULTIPLE:
        update.update(list_inflated=True, list_note=(
            f"할인 전 가격으로 표시한 {_won(listed)}원은 같은 모델 시세 중앙값({market.median_price}원)의 "
            f"{int(listed * 100 / Decimal(market.median_price))}%입니다. 부풀린 정가에서 깎아 준 것처럼 보이게 하는 할인일 수 있으니 "
            "할인율보다 실제 결제 금액을 시세와 비교해 주세요."))
    if offer.discount_ends != UNKNOWN:
        try:
            month_day = offer.discount_ends if len(offer.discount_ends) == 10 else f"{today.year}-{offer.discount_ends}"
            ends = date.fromisoformat(month_day)
        except ValueError:
            ends = None
        percent = offer.discount_percent
        if ends is not None and ends < today:
            update["discount_note"] = (f"할인 기한({ends.isoformat()})이 이미 지났는데도 할인을 표시하고 있습니다. 기한을 계속 바꿔 "
                                       "서두르게 하는 표시일 수 있으니 시세와 비교해 주세요.")
        elif ends is not None and (ends - today).days <= SOON_DAYS and percent is not None and percent >= BIG_DISCOUNT:
            update["discount_note"] = (f"{ends.isoformat()}까지 {percent}% 할인이라고 합니다. 기한이 짧은 큰 할인은 서두르게 하는 "
                                       "방법이기도 하니, 기한보다 시세와 판매자 정보를 먼저 확인해 주세요.")
    return update


def check_market_price(product: ProductDetails, today: date | None = None) -> MarketPrice:
    result = _check_market_price(product)
    bait = option_bait(product)
    update = discount_notes(product, result, today or date.today())
    if bait:
        update.update(option_bait=True, option_price=_won(bait[0]), option_note=bait[1])
    return result.model_copy(update=update) if update else result


def _check_market_price(product: ProductDetails) -> MarketPrice:
    # Refurbished, used and display stock are not the new item the market search finds.
    if product.condition in {"refurbished", "used", "display"}:
        kind = {"refurbished": "리퍼", "used": "중고", "display": "전시"}[product.condition]
        return MarketPrice(status="not_new", label="새 상품 시세와 비교하지 않음",
                           message=f"{kind} 상품이라 새 상품 시세와 비교하지 않았습니다. 상태 등급과 보증 기간을 확인해 주세요.")
    model = product.model_number.strip()
    brand_name = product.brand_name.strip() if product.brand_name.strip() != UNKNOWN else ""
    pattern = _model_pattern(model, brand_name) if model != UNKNOWN else None
    by_name, name_query, numbered = _name_pattern(product.product_name if product.product_name != UNKNOWN else "", brand_name)
    if pattern is None and by_name is None:
        return MarketPrice(status="no_model", label="시세 판단 보류",
                           message="모델명이 확인되지 않아 같은 상품의 시세를 찾지 않았습니다. 모델명을 입력하면 비교할 수 있어요.")
    currency = currency_code(product.currency)
    if currency not in {None, "KRW"}:
        return MarketPrice(message="원화 가격만 국내 쇼핑 시세와 비교합니다.")
    key = os.getenv("SERPER_API_KEY", "").strip()
    brand = product.brand_name.strip() if product.brand_name.strip() != UNKNOWN else ""
    # The name often starts with the brand already; the search does not need it twice.
    named_query = name_query if brand.lower() in name_query else f"{brand} {name_query}".strip()
    query = f"{brand} {model}".strip() if pattern else named_query
    if not key:
        return MarketPrice(query=query, message="쇼핑 검색 키가 설정되지 않아 시세를 확인하지 못했습니다.")
    try:
        matches = _collect(_search(key, query), pattern.search, product) if pattern else []
        loose = False
        # Shops often leave the model code out of titles, so the product name is the second way to find the same item.
        if len(matches) < MIN_MATCHES and by_name is not None:
            named = _collect(_search(key, named_query), by_name, product)
            if len(named) > len(matches):
                matches, query, loose = named, named_query, not numbered
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return MarketPrice(query=query, message="쇼핑 시세 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.")
    if not matches:
        return MarketPrice(status="insufficient", label="시세 판단 보류", query=query,
                           message="같은 상품을 파는 다른 판매처를 찾지 못했습니다. 브랜드 자사몰이나 다른 쇼핑몰의 가격을 직접 비교해 주세요.")

    prices = sorted(Decimal(item.price) for item in matches)
    middle = Decimal(median(prices))
    market = dict(query=query, median_price=_won(middle), min_price=_won(prices[0]), max_price=_won(prices[-1]),
                  match_count=len(matches), listings=sorted(matches, key=lambda item: Decimal(item.price))[:3])
    sale = parse_price(product.price)
    # A bait price is compared as what the product actually costs, the cheapest option of the product itself.
    bait = option_bait(product)
    if bait:
        sale = bait[0]
    if sale is None:
        return MarketPrice(status="no_price", label="시세 판단 보류", **market,
                           message="같은 모델의 시세는 찾았지만 판매 가격이 확인되지 않아 비교하지 않았습니다.")
    # Truncated, so the shown percent never sits on the other side of a threshold.
    ratio = int(sale * 100 / middle)
    if len(matches) < MIN_MATCHES or loose and prices[-1] > prices[0] * NAME_ONLY_SPREAD:
        reason = (f"같은 상품 판매처를 {len(matches)}곳만 찾아" if len(matches) < MIN_MATCHES
                  else "이름으로 찾은 판매처끼리 가격 차이가 커서 용량·구성이 다를 수 있어")
        # Too few or too mixed to call a price cheap, so no percentage is shown that would read as a verdict.
        return MarketPrice(status="reference", label="참고 가격", sale_price=_won(sale), **market,
                           message=f"{reason} 참고 가격으로만 보여 드려요. 구성·용량이 같은지 확인하고 비교해 주세요. "
                                   "판정 점수에는 넣지 않았습니다.")
    status, label, message = rate_ratio(ratio)
    if product.condition == "parallel_import":
        message += " 병행수입 상품이라 국내 정식 수입품보다 싸거나 공식 AS가 다를 수 있습니다."
    return MarketPrice(status=status, label=label, message=message, sale_price=_won(sale), ratio_percent=ratio, **market)
