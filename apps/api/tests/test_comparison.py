import json
import os
import unittest
from unittest.mock import MagicMock, patch

import httpx
from openai import InternalServerError
from fastapi.testclient import TestClient

import main
from comparison import compare_price, compare_product, extract_official_facts, parse_price, validate_facts
from schemas import OfficialEvidence, OfficialFacts, OfficialLookup, OfficialSearchResult, UNKNOWN
from extractor import extract_product_details, unknown_product
from official_brands import OfficialBrand, find_official_brand
from official_search import search_official_pages
from scraper import ProductPage, ProductPageError, _validate_public_url, fetch_product_page


def product(**changes):
    return unknown_product().model_copy(update={
        "brand_name": "Apple", "product_name": "AirPods Pro 3", "model_number": "A3063",
        "price": "299,000원", "currency": "KRW", **changes,
    })


def facts(**changes):
    return OfficialFacts(
        product_name="AirPods Pro 3", model_number="A3063", price="369,000", currency="KRW",
        match="exact", evidence=[OfficialEvidence(field="product_name", quote="AirPods Pro 3")], **changes,
    )


def lookup(status="found", url="https://www.apple.com/kr/airpods-pro/"):
    return OfficialLookup(status=status, message="공식 검색 결과", results=[
        OfficialSearchResult(title="AirPods Pro 3", url=url, snippet="")
    ] if status == "found" else [])


class PriceTests(unittest.TestCase):
    def test_exact_same_currency_price_difference(self):
        price = compare_price(product(), facts(), "exact")
        self.assertEqual(price.status, "available")
        self.assertEqual(price.difference, "-70000")
        self.assertEqual(price.difference_percent, "-18.97")

    def test_no_price_comparison_for_similar_or_other_currency(self):
        self.assertEqual(compare_price(product(), facts(), "similar").status, "unavailable")
        self.assertEqual(compare_price(product(currency="USD"), facts(), "exact").status, "unavailable")

    def test_ambiguous_or_missing_price_is_not_parsed(self):
        for value in (UNKNOWN, "월 12,000원", "299,000~369,000원", "쿠폰 적용 299,000원", "0", "NaN", "1.234,56"):
            with self.subTest(value=value):
                self.assertIsNone(parse_price(value))


class EvidenceTests(unittest.TestCase):
    @patch.dict(os.environ, {"OPENAI_API_KEY": "test-only"})
    @patch("extractor.OpenAI")
    def test_upstream_502_is_identified_without_leaking_service_body(self, client):
        client.return_value.chat.completions.create.side_effect = InternalServerError(
            "private diagnostic text", response=httpx.Response(502, request=httpx.Request("POST", "https://example.test")),
            body={"detail": "private diagnostic text"},
        )
        result, warnings = extract_product_details("AirPods", "AirPods Pro 3")
        self.assertEqual(result.product_name, UNKNOWN)
        self.assertIn("502", warnings[0])
        self.assertNotIn("private diagnostic text", warnings[0])

    def test_fabricated_quote_removes_unverified_fields(self):
        result = validate_facts(facts(), "iPhone 공식 사이트", product())
        self.assertEqual(result.product_name, UNKNOWN)
        self.assertEqual(result.price, UNKNOWN)
        self.assertEqual(result.match, "unknown")

    def test_valid_price_requires_product_specific_quote(self):
        text = "AirPods Pro 3 A3063 369,000원. 공식 온라인 스토어에서 구매하세요."
        profile = OfficialFacts(
            product_name="AirPods Pro 3", model_number="A3063", price="369,000", currency="KRW",
            seller_guidance="공식 온라인 스토어에서 구매하세요.", match="exact",
            evidence=[OfficialEvidence(field=field, quote=quote) for field, quote in (
                ("product_name", "AirPods Pro 3"), ("model_number", "A3063"),
                ("price", "AirPods Pro 3 A3063 369,000원"), ("currency", "369,000원"),
                ("seller_guidance", "공식 온라인 스토어에서 구매하세요."),
            )],
        )
        result = validate_facts(profile, text, product())
        self.assertEqual(result.match, "exact")
        self.assertEqual(result.price, "369,000")
        self.assertEqual(result.currency, "KRW")
        self.assertNotEqual(result.seller_guidance, UNKNOWN)

    def test_unrelated_price_or_model_is_rejected(self):
        profile = OfficialFacts(
            product_name="AirPods Pro 3", price="999,000", currency="USD", model_number="FAKE",
            evidence=[OfficialEvidence(field="product_name", quote="AirPods Pro 3"),
                      OfficialEvidence(field="price", quote="iPhone 999,000원"),
                      OfficialEvidence(field="model_number", quote="A3063"),
                      OfficialEvidence(field="currency", quote="999,000원")], match="exact",
        )
        result = validate_facts(profile, "AirPods Pro 3 A3063 iPhone 999,000원", product())
        self.assertEqual(result.price, UNKNOWN)
        self.assertEqual(result.model_number, UNKNOWN)
        self.assertEqual(result.currency, UNKNOWN)

    def test_different_model_cannot_be_exact(self):
        profile = OfficialFacts(
            product_name="AirPods Pro 3", model_number="A9999", match="exact",
            evidence=[OfficialEvidence(field="model_number", quote="A9999"),
                      OfficialEvidence(field="product_name", quote="AirPods Pro 3")],
        )
        result = validate_facts(profile, "AirPods Pro 3 A9999", product())
        self.assertEqual(result.match, "similar")

    @patch.dict(os.environ, {"OPENAI_API_KEY": "test-only"})
    @patch("comparison.OpenAI")
    def test_actual_extractor_validates_json_and_grounding(self, mock_client):
        mock_client.return_value.__enter__.return_value.chat.completions.create.return_value.choices = [
            MagicMock(message=MagicMock(content=json.dumps({
                "product_name": "AirPods Pro 3", "match": "exact", "price": "369000",
                "evidence": [{"field": "product_name", "quote": "AirPods Pro 3"}],
            })))
        ]
        result = extract_official_facts(
            ProductPage("https://apple.com/", "AirPods", "AirPods Pro 3"), product(model_number=UNKNOWN),
        )
        self.assertEqual(result.match, "exact")
        self.assertEqual(result.price, UNKNOWN)

    def test_matching_name_does_not_prove_a_supplied_model(self):
        profile = OfficialFacts(
            product_name="AirPods Pro 3", match="exact",
            evidence=[OfficialEvidence(field="product_name", quote="AirPods Pro 3")],
        )
        result = validate_facts(profile, "AirPods Pro 3", product(model_number="DIFFERENT-MODEL"))
        self.assertEqual(result.match, "similar")
        self.assertEqual(compare_price(product(), result, result.match).status, "unavailable")


class ComparisonTests(unittest.TestCase):
    def setUp(self):
        from schemas import RiskAnalysis
        patcher = patch("main.analyze_listing_risks", return_value=RiskAnalysis())
        patcher.start()
        self.addCleanup(patcher.stop)

    @patch.dict(os.environ, {"SERPER_API_KEY": "test-only"})
    @patch("official_search.httpx.post")
    def test_apple_search_targets_korean_official_pages(self, post):
        post.return_value.json.return_value = {"organic": []}
        search_official_pages("Apple AirPods Pro 3", find_official_brand("Apple"))
        # A parenthesized single site filter returns no live Serper results.
        self.assertEqual(post.call_args.kwargs["json"]["q"], "Apple AirPods Pro 3 site:apple.com/kr")

    @patch.dict(os.environ, {"SERPER_API_KEY": "test-only"})
    @patch("official_search.httpx.post")
    def test_multiple_sites_are_grouped(self, post):
        post.return_value.json.return_value = {"organic": []}
        brand = OfficialBrand("X", ("a.com", "b.com"), ())
        search_official_pages("X 1", brand)
        self.assertEqual(post.call_args.kwargs["json"]["q"], "X 1 (site:a.com OR site:b.com)")

    @patch("comparison.extract_official_facts", return_value=facts())
    @patch("comparison.fetch_product_page")
    def test_official_input_page_is_read_even_if_search_is_empty(self, fetch, extract):
        url = "https://www.apple.com/kr/shop/product/test/airpods-pro-3"
        fetch.return_value = ProductPage(url, "AirPods", "AirPods Pro 3")
        result = compare_product(product(), url, lookup("no_results"))
        self.assertEqual(result.status, "exact")
        self.assertEqual(result.selected_url, url)
        self.assertEqual(result.price.status, "available")

    @patch("comparison.fetch_product_page", return_value=ProductPage("https://apple.com/p", "AirPods", "AirPods"))
    @patch("comparison.extract_official_facts")
    def test_model_service_error_is_unknown_not_absent(self, extract, fetch):
        extract.side_effect = InternalServerError(
            "private diagnostic text", response=httpx.Response(502, request=httpx.Request("POST", "https://example.test")),
            body={},
        )
        result = compare_product(product(), "https://apple.com/p", lookup())
        self.assertEqual(result.status, "unknown")
        self.assertIn("502", result.warnings[0])
        self.assertNotIn("private diagnostic text", result.warnings[0])

    @patch("comparison.extract_official_facts")
    @patch("comparison.fetch_product_page")
    def test_all_four_outcomes_and_seller_claim(self, fetch, extract):
        fetch.return_value = ProductPage("https://www.apple.com/kr/airpods-pro/", "AirPods", "AirPods Pro 3")
        for status in ("exact", "similar", "not_found", "unknown"):
            extract.return_value = facts().model_copy(update={"match": status})
            result = compare_product(product(), "https://shop.example.com/p", lookup())
            self.assertEqual(result.status, status)
            self.assertEqual(result.seller_status, "unknown")
        result = compare_product(product(), "https://www.apple.com/kr/airpods-pro/", lookup())
        self.assertEqual(result.seller_status, "official_domain")

    @patch("comparison.fetch_product_page", side_effect=ProductPageError("403"))
    def test_failed_fetch_is_unknown_not_absent(self, fetch):
        result = compare_product(product(), "https://shop.example.com/p", lookup())
        self.assertEqual(result.status, "unknown")
        self.assertTrue(result.warnings)

    def test_no_results_and_unsupported_or_unavailable(self):
        for search_status, expected in (("no_results", "not_found"), ("not_supported", "unknown"), ("unavailable", "unknown")):
            self.assertEqual(compare_product(product(), "https://shop.example.com/p", lookup(search_status)).status, expected)

    @patch("comparison.fetch_product_page")
    def test_non_official_urls_are_not_read(self, fetch):
        result = compare_product(product(), "https://shop.example.com/p", lookup(url="https://apple.com.evil.test/p"))
        fetch.assert_not_called()
        self.assertEqual(result.status, "unknown")

    @patch("main.create_official_lookup", return_value=lookup("no_results"))
    def test_corrected_product_endpoint(self, search):
        response = TestClient(main.app).post("/comparisons", json={
            "product_url": "https://shop.example.com/p", "product": product(brand_name="애플").model_dump(),
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["comparison"]["label"], "확인되지 않음")
        self.assertEqual(search.call_args.args[0].brand_name, "애플")

    @patch("main.create_official_lookup", return_value=lookup("no_results"))
    @patch("main.extract_product_details", return_value=(product(), []))
    @patch("main.fetch_product_page")
    def test_analysis_includes_comparison(self, fetch, extract, search):
        fetch.return_value = ProductPage("https://shop.example.com/p", "Test", "AirPods Pro 3")
        response = TestClient(main.app).post("/analyses", json={"product_url": "https://shop.example.com/p"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["comparison"]["status"], "not_found")

    def test_invalid_correction_payload(self):
        self.assertEqual(TestClient(main.app).post("/comparisons", json={"product": {}}).status_code, 422)


class RedirectTests(unittest.TestCase):
    @patch("scraper.socket.getaddrinfo")
    def test_off_domain_redirect_is_rejected_before_network(self, dns):
        with self.assertRaises(ProductPageError):
            _validate_public_url("https://evil.test/path", ("apple.com",))
        dns.assert_not_called()

    @patch("scraper.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("8.8.8.8", 443))])
    def test_redirect_chain_rechecks_official_domain(self, dns):
        original_client = httpx.Client
        visited = []
        def respond(request):
            visited.append((str(request.url), request.headers["host"], request.extensions.get("sni_hostname")))
            return httpx.Response(302, headers={"location": "https://evil.test/p"})
        with patch("scraper.httpx.Client", side_effect=lambda **kwargs: original_client(
            **kwargs, transport=httpx.MockTransport(respond),
        )):
            with self.assertRaises(ProductPageError):
                fetch_product_page("https://apple.com/p", allowed_domains=("apple.com",))
        self.assertEqual(visited, [("https://8.8.8.8/p", "apple.com", "apple.com")])

    @patch("scraper.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("8.8.8.8", 443))])
    def test_connection_uses_validated_ip_and_keeps_final_url(self, dns):
        original_client = httpx.Client
        visited = []
        def respond(request):
            visited.append(str(request.url))
            if request.url.path == "/old":
                return httpx.Response(301, headers={"location": "/kr/p"})
            return httpx.Response(200, headers={"content-type": "text/html"}, html="<title>AirPods</title><p>AirPods</p>")
        with patch("scraper.httpx.Client", side_effect=lambda **kwargs: original_client(
            **kwargs, transport=httpx.MockTransport(respond),
        )):
            page = fetch_product_page("https://www.apple.com/old", allowed_domains=("apple.com",))
        self.assertEqual(visited, ["https://8.8.8.8/old", "https://8.8.8.8/kr/p"])
        self.assertEqual(page.final_url, "https://www.apple.com/kr/p")

    @patch("scraper.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("8.8.8.8", 443))])
    def test_network_errors_allow_manual_input(self, dns):
        original_client = httpx.Client
        for error in (httpx.ConnectTimeout("slow"), httpx.ConnectError("reset")):
            with self.subTest(error=type(error).__name__):
                def respond(request, error=error):
                    raise error
                with patch("scraper.httpx.Client", side_effect=lambda **kwargs: original_client(
                    **kwargs, transport=httpx.MockTransport(respond),
                )):
                    with self.assertRaises(ProductPageError) as raised:
                        fetch_product_page("https://shop.example.com/p")
                self.assertTrue(raised.exception.fallback_allowed)

    @patch("scraper.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("8.8.8.8", 443)), (2, 1, 6, "", ("10.0.0.1", 443))])
    def test_any_private_resolution_is_rejected(self, dns):
        with self.assertRaises(ProductPageError) as raised:
            _validate_public_url("https://shop.example.com/p")
        self.assertFalse(raised.exception.fallback_allowed)


if __name__ == "__main__":
    unittest.main()
