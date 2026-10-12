from typing import Literal

from pydantic import BaseModel, Field, HttpUrl


UNKNOWN = "확인 불가"


class AnalysisRequest(BaseModel):
    product_url: HttpUrl


class ProductDetails(BaseModel):
    brand_name: str = Field(description="브랜드명. 근거가 없으면 확인 불가")
    product_name: str = Field(description="판매 중인 상품명. 근거가 없으면 확인 불가")
    model_number: str = Field(description="제조사 모델명 또는 SKU. 근거가 없으면 확인 불가")
    price: str = Field(description="현재 판매 가격의 숫자 및 표기. 근거가 없으면 확인 불가")
    currency: str = Field(description="가격 통화. 근거가 없으면 확인 불가")
    seller_name: str = Field(description="판매자 또는 판매처명. 근거가 없으면 확인 불가")
    components: list[str] = Field(description="상품 구성품. 근거가 없으면 확인 불가 한 항목만 담는다")


class SourceSummary(BaseModel):
    page_title: str
    final_url: str
    text_length: int


class SupportedBrand(BaseModel):
    name: str
    domains: list[str]


class OfficialSearchResult(BaseModel):
    title: str
    url: str
    snippet: str


class OfficialLookup(BaseModel):
    status: Literal["found", "not_supported", "no_results", "unavailable"]
    brand: SupportedBrand | None = None
    query: str | None = None
    results: list[OfficialSearchResult] = Field(default_factory=list)
    message: str


class AnalysisResponse(BaseModel):
    status: Literal["completed", "manual_input_required"]
    product: ProductDetails
    source: SourceSummary
    warnings: list[str]
    official_lookup: OfficialLookup
