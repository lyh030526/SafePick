import json
import os
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI

from schemas import ProductDetails, UNKNOWN


# 개발 서버가 이전 실행의 환경 변수를 물려받아도 로컬 .env 설정을 우선한다.
load_dotenv(override=True)

EXTRACTION_INSTRUCTIONS = """\
당신은 온라인 쇼핑 페이지에서 상품 정보를 추출하는 도우미입니다.
주어진 판매 페이지의 공개 텍스트만 근거로 아래 JSON 객체를 반환하세요.

반드시 이 키를 정확히 사용합니다:
brand_name, product_name, model_number, price, currency, seller_name, components

- 브랜드명, 상품명, 모델명, 가격, 통화, 판매자명, 구성품을 추출합니다.
- 근거가 부족하거나 여러 후보 중 판단할 수 없으면 반드시 문자열 `확인 불가`를 사용합니다.
- 추측, 일반 상식, 다른 웹사이트 정보는 사용하지 않습니다.
- 가격은 현재 판매 가격만 사용하고, 쿠폰 적용 전후를 구별할 수 없으면 `확인 불가`로 합니다.
- 구성품을 찾지 못하면 components에 `["확인 불가"]`만 넣습니다.
- 상품 본체와 호환 액세서리를 혼동하지 않습니다.
"""

FIELD_ALIASES = {
    "brand_name": ("brand_name", "brand", "브랜드명", "브랜드"),
    "product_name": ("product_name", "product", "상품명", "제품명", "제품"),
    "model_number": ("model_number", "model", "모델명", "모델 번호"),
    "price": ("price", "판매 가격", "판매가격", "가격"),
    "currency": ("currency", "통화"),
    "seller_name": ("seller_name", "seller", "판매처", "판매자명", "판매자"),
    "components": ("components", "included_items", "구성품", "구성", "포함 구성품"),
}


def unknown_product() -> ProductDetails:
    return ProductDetails(
        brand_name=UNKNOWN,
        product_name=UNKNOWN,
        model_number=UNKNOWN,
        price=UNKNOWN,
        currency=UNKNOWN,
        seller_name=UNKNOWN,
        components=[UNKNOWN],
    )


def _value_from_aliases(payload: dict[str, Any], field: str) -> Any:
    for alias in FIELD_ALIASES[field]:
        if alias in payload and payload[alias] not in (None, ""):
            return payload[alias]
    return UNKNOWN


def _normalize_product(payload: dict[str, Any]) -> ProductDetails:
    components = _value_from_aliases(payload, "components")
    if isinstance(components, str):
        components = [item.strip() for item in components.split(",") if item.strip()] or [UNKNOWN]
    if not isinstance(components, list):
        components = [UNKNOWN]

    return ProductDetails(
        brand_name=str(_value_from_aliases(payload, "brand_name")),
        product_name=str(_value_from_aliases(payload, "product_name")),
        model_number=str(_value_from_aliases(payload, "model_number")),
        price=str(_value_from_aliases(payload, "price")),
        currency=str(_value_from_aliases(payload, "currency")),
        seller_name=str(_value_from_aliases(payload, "seller_name")),
        components=[str(item) for item in components],
    )


def _missing_field_warnings(product: ProductDetails) -> list[str]:
    labels = {
        "brand_name": "브랜드명",
        "product_name": "상품명",
        "model_number": "모델명",
        "price": "판매 가격",
        "currency": "통화",
        "seller_name": "판매처",
    }
    missing = [label for field, label in labels.items() if getattr(product, field) == UNKNOWN]
    if product.components == [UNKNOWN]:
        missing.append("구성품")
    return [f"자동 추출 결과 중 {', '.join(missing)}은 직접 확인이 필요합니다."] if missing else []


def extract_product_details(page_title: str, page_text: str) -> tuple[ProductDetails, list[str]]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return unknown_product(), ["OPENAI_API_KEY가 없어 자동 추출 대신 직접 입력이 필요합니다."]

    try:
        client = OpenAI(
            api_key=api_key,
            base_url=os.getenv("OPENAI_BASE_URL") or None,
        )
        completion = client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-5.4-mini"),
            messages=[
                {"role": "system", "content": EXTRACTION_INSTRUCTIONS},
                {
                    "role": "user",
                    "content": f"페이지 제목:\n{page_title}\n\n판매 페이지 공개 텍스트:\n{page_text}",
                },
            ],
            response_format={"type": "json_object"},
        )
        content = completion.choices[0].message.content
        if not content:
            return unknown_product(), ["AI가 상품 정보를 반환하지 않아 직접 입력이 필요합니다."]
        product = _normalize_product(json.loads(content))
        return product, _missing_field_warnings(product)
    except Exception:
        return unknown_product(), ["자동 추출 중 오류가 발생해 직접 입력이 필요합니다."]


def generate_official_search_query(brand_name: str, model_number: str, product_name: str) -> str:
    fallback = " ".join(value for value in (brand_name, model_number, product_name) if value and value != UNKNOWN)
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return fallback

    try:
        client = OpenAI(api_key=api_key, base_url=os.getenv("OPENAI_BASE_URL") or None)
        completion = client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-5.4-mini"),
            messages=[
                {
                    "role": "system",
                    "content": "상품의 공식 사이트 검색어를 만드세요. 브랜드명과 모델명 또는 상품명을 유지하고, 검색어만 한 줄로 반환하세요.",
                },
                {"role": "user", "content": f"브랜드: {brand_name}\n모델명: {model_number}\n상품명: {product_name}"},
            ],
        )
        query = (completion.choices[0].message.content or "").strip().replace("\n", " ")
        return query[:160] or fallback
    except Exception:
        return fallback
