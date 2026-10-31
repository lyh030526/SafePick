import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import httpx
from fastapi.testclient import TestClient

import domain_check
import main
from domain_check import check_domain, registrable_domain
from risk_assessment import assess_risk
from schemas import DomainCheck, RiskAnalysis, SellerVerification
from scraper import ProductPageError
from test_risk_assessment import analyzed, official

NOW = datetime(2026, 10, 31, tzinfo=timezone.utc)
BOOTSTRAP = {"services": [[["com", "shop"], ["https://rdap.example/"]], [["kr"], ["https://rdap.nic.example/"]]]}


def response(status=200, body=None):
    reply = MagicMock(status_code=status)
    reply.json.return_value = body or {}
    reply.raise_for_status.side_effect = None if status < 400 else httpx.HTTPStatusError("x", request=None, response=None)
    return reply


def record(registered, expires, status=("active",)):
    return {"status": list(status), "events": [{"eventAction": "registration", "eventDate": f"{registered}T00:00:00Z"},
                                                {"eventAction": "expiration", "eventDate": f"{expires}T00:00:00Z"}]}


class DomainCheckTests(unittest.TestCase):
    def setUp(self):
        domain_check._bootstrap.clear()
        domain_check._cache.clear()

    def lookup(self, url, reply):
        with patch("domain_check.httpx.get", side_effect=lambda u, **_: response(body=BOOTSTRAP) if "iana" in u else reply) as get:
            return check_domain(url, NOW), get

    def test_registrable_domain(self):
        self.assertEqual(registrable_domain("store.sony.co.kr"), "sony.co.kr")
        self.assertEqual(registrable_domain("www.lg-bestshop.com"), "lg-bestshop.com")

    def test_statuses_follow_the_registration_record(self):
        cases = [(record("2026-10-20", "2027-10-20"), "new_short"),           # reported six days after registration
                 (record("2026-03-01", "2028-03-01"), "new"),                 # new, but registered for two years
                 (record("2025-12-01", "2026-12-01"), "new"),                 # past 180 days
                 (record("2005-01-01", "2027-01-01"), "established"),
                 (record("2025-09-04", "2026-09-04", ("redemption period",)), "expired"),
                 (record("2025-09-04", "2026-09-04"), "expired")]             # past its expiry date
        for body, status in cases:
            with self.subTest(status=status, body=body["events"][0]["eventDate"]):
                domain_check._cache.clear()
                result, _ = self.lookup("https://shop.example.shop/p/1", response(body=body))
                self.assertEqual(result.status, status)
        missing, get = self.lookup("https://gone-shop.com/", response(404))
        self.assertEqual(missing.status, "missing")
        self.assertEqual(get.call_args.args[0], "https://rdap.example/domain/gone-shop.com")

    def test_marketplaces_and_failures_are_not_judged(self):
        self.assertEqual(check_domain("https://smartstore.naver.com/a/products/1").status, "marketplace")
        result, _ = self.lookup("https://shop.unknowntld/", response(body={}))
        self.assertEqual(result.status, "unavailable")
        with patch("domain_check.httpx.get", side_effect=httpx.ConnectTimeout("timeout")):
            self.assertEqual(check_domain("https://another-shop.com/").status, "unavailable")


class DomainLevelTests(unittest.TestCase):
    def test_domain_sets_the_level_but_an_old_domain_earns_nothing(self):
        active = SellerVerification(status="active", label="계속사업자")
        for status, level in [("missing", "high"), ("expired", "high"), ("new_short", "moderate"), ("new", "undetermined"),
                              ("established", "low"), ("marketplace", "low"), ("unavailable", "low")]:
            with self.subTest(status=status):
                result = assess_risk(analyzed(), official(), active, domain=DomainCheck(status=status, label=status,
                                                                                         registered_on="2026-10-20"))
                self.assertEqual(result.level, level)
                self.assertEqual("도메인 운영 기간" in result.missing_checks, status in {"new_short", "new"})
        base = assess_risk(analyzed(), official(), active)
        old = assess_risk(analyzed(), official(), active, domain=DomainCheck(status="established"))
        self.assertEqual((old.score, old.coverage_percent), (base.score, base.coverage_percent))
        self.assertIn("도메인: new_short (등록 2026-10-20)",
                      assess_risk(analyzed(), None, domain=DomainCheck(status="new_short", label="new_short",
                                                                       registered_on="2026-10-20")).reasons)

    def test_domain_warnings_hold_when_the_page_could_not_be_read(self):
        unread = RiskAnalysis(message="판매 페이지를 읽지 못했습니다")
        self.assertEqual(assess_risk(unread, None, domain=DomainCheck(status="expired", label="만료")).level, "high")
        short = assess_risk(unread, None, domain=DomainCheck(status="new_short", label="단기"))
        self.assertEqual(short.level, "moderate")
        self.assertIn("최근에 1년만 등록한 도메인", short.summary)
        self.assertEqual(assess_risk(unread, None, domain=DomainCheck(status="established")).level, "undetermined")

    @patch("main.check_domain", return_value=DomainCheck(status="expired", label="만료된 도메인"))
    @patch("main.fetch_product_page", side_effect=ProductPageError("판매 페이지에 연결하지 못했습니다.", fallback_allowed=True))
    def test_unreadable_page_still_reports_its_domain(self, _fetch, _domain):
        body = TestClient(main.app).post("/analyses", json={"product_url": "https://gone-shop.com/"}).json()
        self.assertEqual(body["status"], "manual_input_required")
        assessment = body["risk_analysis"]["assessment"]
        self.assertEqual((assessment["level"], assessment["domain"]["status"]), ("high", "expired"))


class EnteredDomainTests(unittest.TestCase):
    @patch("main.check_domain", return_value=DomainCheck())
    @patch("main.fetch_product_page")
    def test_the_entered_address_is_judged_not_the_redirect_target(self, fetch, domain):
        fetch.return_value = MagicMock(final_url="https://www.broker.example/forsale", title="For Sale", text="도메인 판매 " * 10)
        with patch("main.analyze_listing_risks", return_value=RiskAnalysis()),                 patch("main.extract_product_details", return_value=(main.unknown_product(), [])):
            TestClient(main.app).post("/analyses", json={"product_url": "https://new-shop.example/"})
        domain.assert_called_once_with("https://new-shop.example/")


if __name__ == "__main__":
    unittest.main()
