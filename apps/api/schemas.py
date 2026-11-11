import base64
import binascii
from io import BytesIO
from typing import Literal

from PIL import Image, UnidentifiedImageError
from pydantic import AwareDatetime, BaseModel, Field, HttpUrl, field_validator, model_validator


UNKNOWN = "확인 불가"


class AnalysisImage(BaseModel):
    mime_type: Literal["image/jpeg", "image/png", "image/webp"]
    base64_data: str = Field(min_length=1, max_length=5_592_408, repr=False)

    @model_validator(mode="after")
    def validate_image(self):
        try:
            data = base64.b64decode(self.base64_data, validate=True)
            if not data or len(data) > 4 * 1024 * 1024:
                raise ValueError("이미지는 한 장에 4MB 이하여야 합니다.")
            with Image.open(BytesIO(data)) as image:
                if Image.MIME.get(image.format) != self.mime_type:
                    raise ValueError("이미지 형식과 파일 내용이 일치하지 않습니다.")
                if image.width * image.height > 40_000_000 or max(image.size) > 16000:
                    raise ValueError("이미지 해상도가 너무 큽니다. 필요한 부분을 잘라 첨부해 주세요.")
                if getattr(image, "is_animated", False):
                    raise ValueError("움직이는 이미지 대신 정지 이미지를 첨부해 주세요.")
                image.verify()
        except (binascii.Error, UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
            raise ValueError("올바른 JPG, PNG, WebP 이미지가 아닙니다.") from error
        return self


class AnalysisRequest(BaseModel):
    product_url: HttpUrl
    provided_text: str | None = Field(default=None, min_length=1, max_length=12000)
    page_title: str = Field(default="", max_length=300)
    input_source: Literal["user_text", "browser_extension"] = "user_text"
    captured_at: AwareDatetime | None = None
    images: list[AnalysisImage] = Field(default_factory=list, max_length=3)
    # The page's main product photo (its og:image), for finding where else the photo appears.
    image_url: HttpUrl | None = None

    @field_validator("provided_text")
    @classmethod
    def nonempty_text(cls, value):
        if value is not None and not value.strip():
            raise ValueError("상품 설명을 입력하거나 해당 항목을 제외해 주세요.")
        return value.strip() if value is not None else None

    @model_validator(mode="after")
    def limit_total_images(self):
        if sum(len(image.base64_data) for image in self.images) > 11_184_816:
            raise ValueError("이미지는 합계 8MB 이내로 첨부해 주세요.")
        return self


class ProductOption(BaseModel):
    """One choice in the listing's option list, as the page prices it. `price` is the option's own price in won digits,
    "+5000" when only a surcharge on the shown price is printed, or 확인 불가."""
    name: str = Field(max_length=120)
    price: str = Field(default=UNKNOWN, max_length=20)
    # The product itself in some colour, size or capacity, or something else sold alongside it (a case, a cable, a gift).
    kind: Literal["main", "addon"] = "main"


class ListingClaim(BaseModel):
    """A sentence where the page says the product is genuine or the seller is official, quoted from the page."""
    kind: Literal["genuine", "official_seller", "official_import", "authorized"]
    quote: str = Field(max_length=300)


class ListingMark(BaseModel):
    """An official or certification mark the page shows, in its text or (from attached screenshots) its images."""
    name: str = Field(max_length=120)
    source: Literal["text", "image"] = "text"


class OfferDetails(BaseModel):
    """How the page presents its price: the headline price before an option is chosen, a list price it is discounted from,
    the discount it claims and until when, and the genuineness claims and marks it shows."""
    display_price: str = Field(default=UNKNOWN, max_length=20)
    list_price: str = Field(default=UNKNOWN, max_length=20)
    discount_percent: int | None = Field(default=None, ge=0, le=100)
    discount_ends: str = Field(default=UNKNOWN, max_length=20)
    claims: list[ListingClaim] = Field(default_factory=list, max_length=8)
    marks: list[ListingMark] = Field(default_factory=list, max_length=8)


class ProductNotice(BaseModel):
    """The listing's required product notice (상품정보제공고시): who made or imported it, where, and its KC numbers."""
    maker: str = UNKNOWN
    importer: str = UNKNOWN
    origin: str = UNKNOWN
    kc_numbers: list[str] = Field(default_factory=list, max_length=8)


class ProductDetails(BaseModel):
    brand_name: str = Field(description="브랜드명. 근거가 없으면 확인 불가")
    product_name: str = Field(description="판매 중인 상품명. 근거가 없으면 확인 불가")
    model_number: str = Field(description="제조사 모델명 또는 SKU. 근거가 없으면 확인 불가")
    price: str = Field(description="현재 판매 가격의 숫자 및 표기. 근거가 없으면 확인 불가")
    currency: str = Field(description="가격 통화. 근거가 없으면 확인 불가")
    seller_name: str = Field(description="판매자 또는 판매처명. 근거가 없으면 확인 불가")
    components: list[str] = Field(description="상품 구성품. 근거가 없으면 확인 불가 한 항목만 담는다")
    options: list[ProductOption] = Field(default_factory=list, max_length=30)
    # What the listing says it is selling: new, refurbished, used or display stock, or a parallel import.
    condition: Literal["new", "refurbished", "used", "display", "parallel_import", "unknown"] = "unknown"
    offer: OfferDetails = Field(default_factory=OfferDetails)
    notice: ProductNotice = Field(default_factory=ProductNotice)


class SourceSummary(BaseModel):
    page_title: str
    final_url: str
    text_length: int
    kind: Literal["server_page", "user_text", "browser_extension", "user_images", "mixed"] = "server_page"
    image_count: int = 0
    captured_at: AwareDatetime | None = None


class SupportedBrand(BaseModel):
    name: str
    domains: list[str]


class OfficialSearchResult(BaseModel):
    title: str
    url: str
    snippet: str


class MakerCheck(BaseModel):
    """For a product with no official site to compare: the maker the notice names and whether the seller is that maker."""
    status: Literal["seller_is_maker", "listed", "see_detail", "missing"]
    label: str
    message: str
    maker: str = UNKNOWN
    importer: str = UNKNOWN
    origin: str = UNKNOWN
    kc_numbers: list[str] = Field(default_factory=list)
    kc_link: str | None = None


class OfficialLookup(BaseModel):
    status: Literal["found", "not_supported", "no_results", "unavailable"]
    brand: SupportedBrand | None = None
    query: str | None = None
    results: list[OfficialSearchResult] = Field(default_factory=list)
    message: str
    # The official site was found by searching the brand name rather than taken from the curated brands.
    discovered: bool = False
    maker: MakerCheck | None = None


class ComparisonRequest(BaseModel):
    product_url: HttpUrl
    product: ProductDetails
    sale_text: str = Field(default="", max_length=12000)
    page_title: str = Field(default="", max_length=300)


class OfficialEvidence(BaseModel):
    field: Literal["product_name", "model_number", "price", "currency", "seller_guidance"]
    quote: str = Field(min_length=1, max_length=1200)


class OfficialFacts(BaseModel):
    product_name: str = UNKNOWN
    model_number: str = UNKNOWN
    price: str = UNKNOWN
    currency: str = UNKNOWN
    seller_guidance: str = UNKNOWN
    match: Literal["exact", "similar", "not_found", "unknown"] = "unknown"
    evidence: list[OfficialEvidence] = Field(default_factory=list)


class OfficialPageSummary(BaseModel):
    url: str
    title: str
    facts: OfficialFacts


class PriceComparison(BaseModel):
    status: Literal["available", "unavailable"] = "unavailable"
    sale_price: str | None = None
    official_price: str | None = None
    currency: str | None = None
    difference: str | None = None
    difference_percent: str | None = None
    message: str


class ProductComparison(BaseModel):
    status: Literal["exact", "similar", "not_found", "unknown"] = "unknown"
    label: str = "확인 불가"
    message: str
    selected_url: str | None = None
    pages: list[OfficialPageSummary] = Field(default_factory=list)
    price: PriceComparison
    seller_status: Literal["official_domain", "unknown"] = "unknown"
    seller_message: str = "판매자명만으로 공식 판매처 여부를 판단할 수 없습니다."
    warnings: list[str] = Field(default_factory=list)


class ListingCondition(BaseModel):
    status: Literal["found", "unknown"] = "unknown"
    text: str = UNKNOWN
    quotes: list[str] = Field(default_factory=list)


class ListingConditions(BaseModel):
    description: ListingCondition = Field(default_factory=ListingCondition)
    components: ListingCondition = Field(default_factory=ListingCondition)
    options: ListingCondition = Field(default_factory=ListingCondition)
    shipping: ListingCondition = Field(default_factory=ListingCondition)
    returns: ListingCondition = Field(default_factory=ListingCondition)
    warranty: ListingCondition = Field(default_factory=ListingCondition)


class PurchaseCheck(BaseModel):
    id: str
    category: Literal["model_mismatch", "components_mismatch", "ambiguous_conditions", "discount_claim", "purchase_pressure",
                      "review_pattern", "off_platform", "shipping_mismatch", "missing_information"]
    kind: Literal["attention", "needs_check"]
    title: str
    explanation: str
    quotes: list[str] = Field(default_factory=list)
    how_to_check: str


class RiskCriterion(BaseModel):
    key: Literal["official", "description", "purchase_terms", "seller", "price", "history", "claims"]
    label: str
    status: Literal["confirmed", "partial", "attention", "unknown"]
    detail: str


class DomainCheck(BaseModel):
    status: Literal["missing", "expired", "new_short", "new", "established", "marketplace", "unavailable"] = "unavailable"
    label: str = "도메인 조회 불가"
    message: str = ""
    domain: str | None = None
    registered_on: str | None = None
    expires_on: str | None = None
    age_days: int | None = None
    # A domain the Seoul e-commerce center reported as a scam site, and the brand a domain borrows without being its own.
    reported_notice: str | None = None
    impersonates: str | None = None


class RiskAssessment(BaseModel):
    level: Literal["high", "moderate", "low", "undetermined"] = "undetermined"
    label: str = "판단 보류"
    summary: str = "확인할 자료가 부족하여 주의 수준을 정하지 않았습니다."
    reasons: list[str] = Field(default_factory=list)
    missing_checks: list[str] = Field(default_factory=list)
    criteria: list[RiskCriterion] = Field(default_factory=list)
    score: int | None = None
    score_label: str = "점수 보류"
    coverage_percent: int = 0
    checked_count: int = 0
    rule_version: str = "1"
    domain: DomainCheck | None = None


class SellerInfo(BaseModel):
    business_name: str = UNKNOWN
    representative: str = UNKNOWN
    business_number: str = UNKNOWN
    mail_order_number: str = UNKNOWN
    address: str = UNKNOWN
    quote: str = ""


class MailOrderCheck(BaseModel):
    status: Literal["matched", "name_absent", "domain_differs", "mismatch", "closed", "not_found", "unavailable"] = "unavailable"
    label: str = "신고 조회 불가"
    message: str = ""
    registered_name: str | None = None
    registered_representative: str | None = None
    report_number: str | None = None
    registered_domains: list[str] = Field(default_factory=list)


class SellerHistory(BaseModel):
    """The seller's past in the FTC file: other trade names on the number, closed numbers of the same name and owner."""
    status: Literal["reopened", "renamed", "reopened_once", "other_numbers"]
    label: str
    message: str
    closed_numbers: int = 0
    other_names: list[str] = Field(default_factory=list)


class SellerVerification(BaseModel):
    status: Literal["active", "suspended", "closed", "unregistered", "invalid_number", "marketplace_listed", "platform_direct",
                    "overseas", "not_found",
                    "unavailable"] = "not_found"
    label: str = "사업자 정보 없음"
    message: str = "판매 자료에서 사업자등록번호를 찾지 못했습니다."
    seller: SellerInfo = Field(default_factory=SellerInfo)
    tax_type: str | None = None
    closed_on: str | None = None
    mail_order: MailOrderCheck | None = None
    # "registry" when the page hid the number and it was found from the trade name and representative.
    number_source: Literal["page", "registry"] = "page"
    # The marketplace's own buyer rating of the seller (Coupang: "판매자 평가 93% (70)").
    marketplace_rating: int | None = None
    rating_count: int | None = None
    history: SellerHistory | None = None


class MarketListing(BaseModel):
    title: str
    mall: str
    price: str
    link: str


class MarketPrice(BaseModel):
    status: Literal["far_below", "below", "typical", "reference", "insufficient", "no_model", "no_price", "not_new", "unavailable"] = "unavailable"
    label: str = "시세 확인 불가"
    message: str = "같은 상품의 시세를 확인하지 못했습니다."
    query: str | None = None
    sale_price: str | None = None
    median_price: str | None = None
    min_price: str | None = None
    max_price: str | None = None
    ratio_percent: int | None = None
    match_count: int = 0
    listings: list[MarketListing] = Field(default_factory=list)
    # The shown price is far below every option of the product itself: the price that is actually paid is an option's.
    option_bait: bool = False
    option_price: str | None = None
    option_note: str | None = None
    # A list price the discount is taken from that sits far above what the market charges, and a discount deadline that
    # has already passed or is close; both are shown with the price, the first also counts against the price criterion.
    list_inflated: bool = False
    list_note: str | None = None
    discount_note: str | None = None


class PhotoMatch(BaseModel):
    title: str
    source: str
    link: str
    kind: Literal["reported", "overseas_cheap", "second_hand", "official", "other"]


class PhotoCheck(BaseModel):
    """Other pages that use the listing's main product photo."""
    status: Literal["overseas_cheap", "reported", "official", "elsewhere", "none", "unavailable"]
    label: str
    message: str
    matches: list[PhotoMatch] = Field(default_factory=list)
    match_count: int = 0
    overseas_count: int = 0


class ClaimCheck(BaseModel):
    """The page's genuineness and official-seller claims and marks, held against who the seller actually is."""
    status: Literal["confirmed", "contradicted", "unverified"] = "unverified"
    label: str
    message: str
    claims: list[ListingClaim] = Field(default_factory=list)
    marks: list[ListingMark] = Field(default_factory=list)
    brand_owner: str | None = None


class ReviewComplaints(BaseModel):
    """1-2 star reviews that report a counterfeit, non-delivery, no answer, or fraud. Shown for reference only."""
    low_reviews: int = 0
    complaints: int = 0
    same_seller: int = 0
    quotes: list[str] = Field(default_factory=list)


class RiskAnalysis(BaseModel):
    status: Literal["completed", "insufficient", "unavailable"] = "unavailable"
    message: str = "위험 신호 분석 결과가 없습니다. 상품 설명으로 다시 분석해 주세요."
    conditions: ListingConditions = Field(default_factory=ListingConditions)
    checklist: list[PurchaseCheck] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    assessment: RiskAssessment = Field(default_factory=RiskAssessment)
    review_complaints: ReviewComplaints | None = None
    claim_check: ClaimCheck | None = None
    photo_check: PhotoCheck | None = None


class ComparisonResponse(BaseModel):
    official_lookup: OfficialLookup
    comparison: ProductComparison
    risk_analysis: RiskAnalysis = Field(default_factory=RiskAnalysis)
    seller_verification: SellerVerification = Field(default_factory=SellerVerification)
    market_price: MarketPrice = Field(default_factory=MarketPrice)


class AnalysisResponse(BaseModel):
    status: Literal["completed", "manual_input_required"]
    product: ProductDetails
    source: SourceSummary
    warnings: list[str]
    official_lookup: OfficialLookup
    comparison: ProductComparison | None = None
    risk_analysis: RiskAnalysis = Field(default_factory=RiskAnalysis)
    seller_verification: SellerVerification = Field(default_factory=SellerVerification)
    market_price: MarketPrice = Field(default_factory=MarketPrice)
    sale_text: str = Field(default="", max_length=12000)


class GroupAnalysisRequest(BaseModel):
    """Several listings of the same product, each captured by the extension from the shopper's own browser."""
    listings: list[AnalysisRequest] = Field(min_length=2, max_length=10)

    @field_validator("listings")
    @classmethod
    def text_required(cls, value):
        if any(item.provided_text is None for item in value):
            raise ValueError("비교할 판매 페이지는 확장 프로그램으로 읽은 내용이 있어야 합니다.")
        return value


class GroupListing(BaseModel):
    index: int
    rank: int
    product_url: str
    page_title: str
    seller_name: str
    seller_kind: str
    price: int | None = None
    price_percent: int | None = None
    model_number: str
    level: Literal["high", "moderate", "low", "undetermined"]
    label: str
    score: int | None = None
    summary: str
    notes: list[str] = Field(default_factory=list)
    analysis: AnalysisResponse


class GroupAnalysisResponse(BaseModel):
    listings: list[GroupListing]
    median_price: int | None = None
    model_number: str
    summary: str
    warnings: list[str] = Field(default_factory=list)


class ConversationCheckRequest(BaseModel):
    """A conversation with a seller, as screenshots or pasted text. Nothing of it is stored."""
    images: list[AnalysisImage] = Field(default_factory=list, max_length=4)
    text: str | None = Field(default=None, max_length=8000)
    # Where the conversation took place: the marketplace's own inquiry or chat, or a messenger or text message outside it.
    channel: Literal["marketplace", "messenger", "unknown"] = "unknown"

    @model_validator(mode="after")
    def material_required(self):
        if not self.images and not (self.text or "").strip():
            raise ValueError("대화 캡처를 첨부하거나 대화 내용을 붙여넣어 주세요.")
        if sum(len(image.base64_data) for image in self.images) > 11_184_816:
            raise ValueError("이미지는 합계 8MB 이내로 첨부해 주세요.")
        return self


class ConversationSignal(BaseModel):
    kind: Literal["off_platform_payment", "fake_safe_payment", "payment_link", "off_platform_contact", "impersonation",
                  "refund_lure", "personal_info", "urgency", "too_good"]
    label: str
    severity: Literal["high", "moderate", "info"]
    quote: str
    advice: str


class ConversationLink(BaseModel):
    url: str
    domain: str | None = None
    status: Literal["marketplace", "reported", "impersonates", "missing", "expired", "new_short", "new", "established",
                    "unavailable"] = "unavailable"
    label: str
    message: str


class LookupNumber(BaseModel):
    """An account or phone number in the conversation, masked, for the shopper to look up in the police's own service."""
    kind: Literal["account", "phone"]
    masked: str
    bank: str | None = None


class ConversationCheck(BaseModel):
    level: Literal["high", "moderate", "low", "undetermined"] = "undetermined"
    label: str = "판단 보류"
    summary: str
    signals: list[ConversationSignal] = Field(default_factory=list)
    links: list[ConversationLink] = Field(default_factory=list)
    lookup_numbers: list[LookupNumber] = Field(default_factory=list)
    read_length: int = 0
    warnings: list[str] = Field(default_factory=list)


class AnalysisQuestion(BaseModel):
    """A shopper's question about one analysis, answered only from that analysis' own findings."""
    question: str = Field(min_length=2, max_length=300)
    product: ProductDetails
    risk_analysis: RiskAnalysis
    seller_verification: SellerVerification | None = None
    market_price: MarketPrice | None = None
    comparison: ProductComparison | None = None


class AnswerCitation(BaseModel):
    id: str
    text: str


class AnalysisAnswer(BaseModel):
    status: Literal["answered", "unavailable"] = "answered"
    answer: str
    citations: list[AnswerCitation] = Field(default_factory=list)
