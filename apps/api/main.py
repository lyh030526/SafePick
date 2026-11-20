import re
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse

from accounts import delete_account
from chat_check import check_conversation
from claims_check import check_claims
from comparison import compare_product
from group_comparison import compare_group
from extractor import extract_product_details, generate_official_search_query, transcribe_images, unknown_product
from market_price import check_market_price
from maker_check import check_maker
from official_brands import OFFICIAL_BRANDS, find_official_brand
from official_discovery import discover_official_brand
from official_search import OfficialSearchError, search_official_pages
from photo_check import check_photo
from question_answer import answer_question
from request_limits import AnalysisBodyLimit, AnalysisRateLimit
from risk_analysis import analyze_listing_risks, review_complaints
from domain_check import check_domain
from risk_assessment import assess_risk
from schemas import (
    AnalysisAnswer, AnalysisQuestion, AnalysisRequest, AnalysisResponse, ComparisonRequest, ComparisonResponse,
    ConversationCheck, ConversationCheckRequest, GroupAnalysisRequest, GroupAnalysisResponse, OfficialLookup,
    ProductDetails, RiskAnalysis, SourceSummary, SupportedBrand, UNKNOWN,
)
from scraper import FOOTER_LENGTH, RETURN_TERMS, ProductPage, ProductPageError, fetch_product_page
from mail_order import with_mail_order
from seller_history import with_history
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
    # The local app by default; a deployment lists its own web address(es), comma-separated.
    allow_origins=[origin.strip() for origin in (os.getenv("SAFEPICK_ALLOWED_ORIGINS")
                   or "http://localhost:8081,http://localhost:8082").split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/brands", response_model=list[SupportedBrand])
def list_supported_brands() -> list[SupportedBrand]:
    return [SupportedBrand(name=brand.name, domains=list(brand.domains)) for brand in OFFICIAL_BRANDS]


def create_official_lookup(product: ProductDetails, url: str = "") -> OfficialLookup:
    brand = find_official_brand(product.brand_name)
    discovered = False
    if not brand:
        # Any brand's official site may be found by its name; small makers without one get the product notice instead.
        brand = discover_official_brand(product.brand_name, url)
        discovered = brand is not None
    if not brand:
        return OfficialLookup(
            status="not_supported",
            message="이 브랜드의 공식 사이트를 찾지 못해 공식 정보와 비교하지 않았습니다. 대신 상품정보 고시의 제조·수입사를 확인했어요.",
        )
    lookup = _lookup_on(product, brand)
    return lookup.model_copy(update={"discovered": True}) if discovered else lookup


def _lookup_on(product: ProductDetails, brand) -> OfficialLookup:

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


def analyze_product(product, url, title, text, entered_url=None, image_url=None):
    # The listing review, seller check, and market search do not depend on the official lookup, so run them at once.
    with ThreadPoolExecutor(max_workers=4) as executor:
        # The address the shopper entered is the one to judge; a parked domain redirects to an old broker site.
        domain_future = executor.submit(check_domain, entered_url or url)
        risk_future = executor.submit(analyze_listing_risks, product, title, text)
        seller_future = executor.submit(lambda: with_history(with_mail_order(verify_seller(text, url), url, text)))
        market_future = executor.submit(check_market_price, product)
        photo_future = executor.submit(check_photo, image_url, url)
        lookup = create_official_lookup(product, url)
        comparison = compare_product(product, url, lookup)
        analysis = risk_future.result()
        seller = seller_future.result()
        market = market_future.result()
    photo = photo_future.result()
    claims = check_claims(product, seller, text, market, photo)
    # Without an official page that confirms the product, who made it is what can still be checked.
    if comparison is None or comparison.status != "exact":
        lookup = lookup.model_copy(update={"maker": check_maker(product, seller)})
    # A brand without a supported official site has nothing to compare, so the criterion is left out of the score. A site
    # found by searching the brand name counts only when it confirms the same product: a page it does not show may just
    # be missing from a small maker's site.
    scored = None if lookup.status == "not_supported" or lookup.discovered and comparison.status != "exact" else comparison
    assessment = assess_risk(analysis, scored, seller, market,
                             domain=domain_future.result(), claims=claims)
    complaints = review_complaints(text, seller.seller.business_name)
    return lookup, comparison, analysis.model_copy(update={"assessment": assessment, "review_complaints": complaints,
                                                           "claim_check": claims, "photo_check": photo}), seller, market


def analyze_provided(request: AnalysisRequest) -> AnalysisResponse:
    """Analyze material the shopper provided (extension capture, pasted text, or images) instead of fetching the page."""
    text = request.provided_text or ""
    # A phone shopper's screenshots are transcribed so the seller table, Q&A, and reviews in them are checked too. Quotes
    # from this part come from the transcription, which the notice below says.
    screen = transcribe_images(request.images) if request.images else ""
    if screen:
        text = f"{text}\n\n화면 캡처에서 읽은 글자:\n{screen}".strip()[:12000]
    product, warnings = extract_product_details(request.page_title, text, images=request.images)
    lookup, comparison, risk, seller, market = analyze_product(
        product, str(request.product_url), request.page_title, text,
        image_url=str(request.image_url) if request.image_url else None)
    kind = ("mixed" if text and request.images else "user_images" if request.images
            else request.input_source)
    notice = "사용자가 제공한 자료를 분석했습니다. 판매 페이지의 현재 내용과 일치하는지는 별도 확인이 필요합니다."
    if request.images:
        notice += " 이미지의 외형만으로 정품 여부나 판매자 신뢰도를 판정하지 않습니다."
    if screen:
        notice += " 화면 캡처의 글자는 AI가 옮겨 적은 것이라 원문과 다를 수 있으니, 인용된 문장을 캡처에서 직접 확인해 주세요."
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


def with_return_policy(page: ProductPage) -> ProductPage:
    """Own malls keep their return terms on a guide page; when the product page shows none, read the first such page of
    the same site and put its return sentences in front, keeping the page's head and footer within the length limit."""
    if RETURN_TERMS.search(page.text) or not page.policy_links:
        return page
    for link in page.policy_links[:2]:
        try:
            guide = fetch_product_page(link)
        except (ProductPageError, ValueError):
            continue
        sentences = [part.strip() for part in re.split(r"(?<=[.다요])\s+|\s{2,}", guide.text)
                     if re.search(r"반품|교환|환불|청약\s*철회", part)]
        excerpt = " ".join(sentences)[:1500]
        if not RETURN_TERMS.search(excerpt):
            continue
        head = f"반품·교환 안내(같은 쇼핑몰 안내 페이지 {link}):\n{excerpt}\n\n"
        room = 12000 - len(head)
        text = page.text if len(page.text) <= room else f"{page.text[:room - FOOTER_LENGTH - 3]} … {page.text[-FOOTER_LENGTH:]}"
        return ProductPage(final_url=page.final_url, title=page.title, text=head + text, policy_links=page.policy_links,
                           image_url=page.image_url)
    return page


app.delete("/account")(delete_account)


@app.post("/conversation-checks", response_model=ConversationCheck)
def create_conversation_check(request: ConversationCheckRequest) -> ConversationCheck:
    return check_conversation(request)


@app.post("/analysis-questions", response_model=AnalysisAnswer)
def create_analysis_answer(request: AnalysisQuestion) -> AnalysisAnswer:
    return answer_question(request)


@app.post("/group-analyses", response_model=GroupAnalysisResponse)
def create_group_analysis(request: GroupAnalysisRequest) -> GroupAnalysisResponse:
    # Each listing runs the full analysis; a few at a time keeps the model and lookup APIs within their rate limits.
    with ThreadPoolExecutor(max_workers=3) as executor:
        results = list(executor.map(analyze_provided, request.listings))
    return compare_group(results)


@app.post("/analyses", response_model=AnalysisResponse)
def create_analysis(request: AnalysisRequest) -> AnalysisResponse:
    if request.provided_text is not None or request.images:
        return analyze_provided(request)
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

    page = with_return_policy(page)
    product, warnings = extract_product_details(page.title, page.text)
    status = "completed" if not warnings else "manual_input_required"
    lookup, comparison, risk, seller, market = analyze_product(product, page.final_url, page.title, page.text,
                                                               str(request.product_url), page.image_url)
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


# The web version of the app (`npx expo export -p web` in apps/mobile, copied to apps/api/web), served from the API's own
# address so the browser needs no cross-origin access. Registered last, so every API route above still wins; any other
# GET path is a file of the build or, for the app's own pages (/browse, ...), its single-page index.html.
WEB_DIR = (Path(__file__).parent / "web").resolve()


@app.get("/{path:path}", include_in_schema=False)
def web_app(path: str):
    if not (WEB_DIR / "index.html").is_file():
        raise HTTPException(status_code=404, detail="Not Found")
    file = (WEB_DIR / path).resolve()
    if path and file.is_file() and file.is_relative_to(WEB_DIR):
        return FileResponse(file)
    return FileResponse(WEB_DIR / "index.html")
