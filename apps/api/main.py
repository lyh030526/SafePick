from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from extractor import extract_product_details, generate_official_search_query, unknown_product
from official_brands import OFFICIAL_BRANDS, find_official_brand
from official_search import OfficialSearchError, search_official_pages
from schemas import AnalysisRequest, AnalysisResponse, OfficialLookup, SourceSummary, SupportedBrand, UNKNOWN
from scraper import ProductPageError, fetch_product_page


app = FastAPI(title="SafePick API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8081"],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/brands", response_model=list[SupportedBrand])
def list_supported_brands() -> list[SupportedBrand]:
    return [SupportedBrand(name=brand.name, domains=list(brand.domains)) for brand in OFFICIAL_BRANDS]


def create_official_lookup(product) -> OfficialLookup:
    brand = find_official_brand(product.brand_name)
    if not brand:
        return OfficialLookup(
            status="not_supported",
            message="현재는 지원 브랜드의 공식 사이트 정보만 비교할 수 있습니다.",
        )

    query = generate_official_search_query(product.brand_name, product.model_number, product.product_name)
    try:
        results = search_official_pages(query, brand)
    except OfficialSearchError:
        return OfficialLookup(
            status="unavailable",
            brand=SupportedBrand(name=brand.name, domains=list(brand.domains)),
            query=query,
            message="공식 사이트 검색을 지금 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
        )

    if not results:
        return OfficialLookup(
            status="no_results",
            brand=SupportedBrand(name=brand.name, domains=list(brand.domains)),
            query=query,
            message="공식 사이트에서 일치하는 상품 정보를 찾지 못했습니다. 모델명을 다시 확인해 주세요.",
        )
    return OfficialLookup(
        status="found",
        brand=SupportedBrand(name=brand.name, domains=list(brand.domains)),
        query=query,
        results=results,
        message="공식 도메인에서 찾은 상품 정보입니다.",
    )


@app.post("/analyses", response_model=AnalysisResponse)
def create_analysis(request: AnalysisRequest) -> AnalysisResponse:
    try:
        page = fetch_product_page(str(request.product_url))
    except ProductPageError as error:
        if error.fallback_allowed:
            return AnalysisResponse(
                status="manual_input_required",
                product=unknown_product(),
                source=SourceSummary(
                    page_title=UNKNOWN,
                    final_url=str(request.product_url),
                    text_length=0,
                ),
                warnings=[f"자동으로 판매 페이지를 읽지 못했습니다: {error}", "상품 정보를 직접 입력해 주세요."],
                official_lookup=OfficialLookup(
                    status="not_supported",
                    message="브랜드 정보를 추출한 뒤 공식 사이트 비교를 진행할 수 있습니다.",
                ),
            )
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception:
        raise HTTPException(status_code=502, detail="상품 페이지를 불러오는 중 오류가 발생했습니다.") from None

    product, warnings = extract_product_details(page.title, page.text)
    status = "completed" if not warnings else "manual_input_required"
    return AnalysisResponse(
        status=status,
        product=product,
        source=SourceSummary(
            page_title=page.title,
            final_url=page.final_url,
            text_length=len(page.text),
        ),
        warnings=warnings,
        official_lookup=create_official_lookup(product),
    )
