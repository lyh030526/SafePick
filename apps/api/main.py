from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from comparison import compare_product
from extractor import extract_product_details, generate_official_search_query, unknown_product
from market_price import check_market_price
from official_brands import OFFICIAL_BRANDS, find_official_brand
from official_search import OfficialSearchError, search_official_pages
from request_limits import AnalysisBodyLimit, AnalysisRateLimit
from risk_analysis import analyze_listing_risks
from domain_check import check_domain
from risk_assessment import assess_risk
from schemas import (
    AnalysisRequest, AnalysisResponse, ComparisonRequest, ComparisonResponse, OfficialLookup,
    ProductDetails, RiskAnalysis, SourceSummary, SupportedBrand, UNKNOWN,
)
from scraper import ProductPageError, fetch_product_page
from mail_order import with_mail_order
from seller_verification import verify_seller


app = FastAPI(title="SafePick API", version="0.5.1")


@app.exception_handler(RequestValidationError)
async def validation_error(_request, error):
    # Never echo base64 images or submitted page contents in validation responses.
    return JSONResponse(status_code=422, content={"detail": [
        {"loc": list(item["loc"]), "msg": item["msg"], "type": item["type"]}
        for item in error.errors()
    ]})

app.add_middleware(AnalysisBodyLimit)
# Added last, so it runs first and rejects excess requests before reading the body.
app.add_middleware(AnalysisRateLimit)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8081", "http://localhost:8082"],
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


def create_official_lookup(product: ProductDetails) -> OfficialLookup:
    brand = find_official_brand(product.brand_name)
    if not brand:
        return OfficialLookup(
            status="not_supported",
            message="현재는 지원 브랜드의 공식 사이트 정보만 비교할 수 있습니다.",
        )

    if all(value.strip() in {"", UNKNOWN} for value in (product.model_number, product.product_name)):
        return OfficialLookup(
            status="unavailable", brand=SupportedBrand(name=brand.name, domains=list(brand.domains)),
            message="상품명 또는 모델명을 입력한 뒤 공식 정보를 비교해 주세요.",
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


@app.post("/comparisons", response_model=ComparisonResponse)
def create_comparison(request: ComparisonRequest) -> ComparisonResponse:
    lookup, comparison, risk, seller, market = analyze_product(
        request.product, str(request.product_url), request.page_title, request.sale_text,
    )
    return ComparisonResponse(official_lookup=lookup, comparison=comparison, risk_analysis=risk,
                              seller_verification=seller, market_price=market)


def analyze_product(product, url, title, text, entered_url=None):
    # The listing review, seller check, and market search do not depend on the official lookup, so run them at once.
    with ThreadPoolExecutor(max_workers=4) as executor:
        # The address the shopper entered is the one to judge; a parked domain redirects to an old broker site.
        domain_future = executor.submit(check_domain, entered_url or url)
        risk_future = executor.submit(analyze_listing_risks, product, title, text)
        seller_future = executor.submit(lambda: with_mail_order(verify_seller(text, url), url, text))
        market_future = executor.submit(check_market_price, product)
        lookup = create_official_lookup(product)
        comparison = compare_product(product, url, lookup)
        analysis = risk_future.result()
        seller = seller_future.result()
        market = market_future.result()
    assessment = assess_risk(analysis, comparison, seller, market, domain=domain_future.result())
    return lookup, comparison, analysis.model_copy(update={"assessment": assessment}), seller, market


@app.post("/analyses", response_model=AnalysisResponse)
def create_analysis(request: AnalysisRequest) -> AnalysisResponse:
    if request.provided_text is not None or request.images:
        text = request.provided_text or ""
        product, warnings = extract_product_details(request.page_title, text, images=request.images)
        lookup, comparison, risk, seller, market = analyze_product(product, str(request.product_url), request.page_title, text)
        kind = ("mixed" if text and request.images else "user_images" if request.images
                else request.input_source)
        notice = "사용자가 제공한 자료를 분석했습니다. 판매 페이지의 현재 내용과 일치하는지는 별도 확인이 필요합니다."
        if request.images:
            notice += " 이미지의 외형만으로 정품 여부나 판매자 신뢰도를 판정하지 않습니다."
        return AnalysisResponse(
            status="manual_input_required" if warnings else "completed",
            product=product,
            source=SourceSummary(
                page_title=request.page_title or "사용자 제공 상품 자료",
                final_url=str(request.product_url), text_length=len(text), kind=kind,
                image_count=len(request.images), captured_at=request.captured_at,
            ),
            warnings=[notice, *warnings], official_lookup=lookup,
            comparison=comparison, risk_analysis=risk, seller_verification=seller, market_price=market, sale_text=text,
        )
    try:
        page = fetch_product_page(str(request.product_url))
    except ProductPageError as error:
        if error.fallback_allowed:
            # A page that cannot be read still has a domain to check: a missing or expired one is a warning by itself.
            domain = check_domain(str(request.product_url))
            unread = RiskAnalysis(message=f"판매 페이지를 읽지 못했습니다: {error}")
            return AnalysisResponse(
                risk_analysis=unread.model_copy(update={"assessment": assess_risk(unread, None, domain=domain)}),
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
    lookup, comparison, risk, seller, market = analyze_product(product, page.final_url, page.title, page.text,
                                                               str(request.product_url))
    return AnalysisResponse(
        status=status,
        product=product,
        source=SourceSummary(
            page_title=page.title,
            final_url=page.final_url,
            text_length=len(page.text),
        ),
        warnings=warnings,
        official_lookup=lookup,
        comparison=comparison,
        risk_analysis=risk,
        seller_verification=seller,
        market_price=market,
        sale_text=page.text,
    )
