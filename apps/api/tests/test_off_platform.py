"""Payment or contact moved off the platform, and reported or brand-lookalike domains."""
import unittest
from datetime import date
from unittest.mock import patch

import httpx

from domain_check import check_domain, domain_flags
from risk_analysis import off_platform_checks
from risk_assessment import assess_risk
from schemas import DomainCheck, RiskAnalysis, SellerVerification
from test_marketplace_rules import MARKETPLACE, TODAY, listing, seller

OWN_MALL = DomainCheck(status="established", label="오래된 도메인", domain="shop.example")


class DetectorTests(unittest.TestCase):
    def test_messenger_and_transfer_requests_are_found(self):
        found = {
            "주문 전 카톡 아이디 abc123 으로 문의주시면 추가 할인 해드려요.": "off_platform_contact",
            "빠른 상담은 https://open.kakao.com/o/sAbCdE 로 연락주세요.": "off_platform_contact",
            "A 네 고객님 재고 문의는 카톡 ID sale77 로 주시면 더 저렴하게 드려요": "off_platform_contact",
            "계좌이체 시 5% 추가 할인됩니다.": "off_platform_payment",
            "결제 후 국민 123456-01-234567 로 입금 부탁드립니다.": "off_platform_payment",
        }
        for text, kind in found.items():
            with self.subTest(text=text):
                checks = off_platform_checks(text)
                self.assertEqual([item.id for item in checks], [kind])
                self.assertEqual(checks[0].quotes, [text])

    def test_warnings_support_channels_and_escrow_are_not(self):
        for text in ["판매자가 현금거래를 요구하면 거부하시고 즉시 사기 거래 신고센터 (1670-9832)에 신고하시기 바랍니다.",
                     "결제 수단: 신용카드, 무통장입금, 휴대폰 결제", "AS 문의 카카오톡 채널 상담 운영시간 10시~17시",
                     "모든 무통장입금 주문에 대해 KG이니시스의 에스크로 구매안전서비스를 자동 적용하고 있습니다."]:
            with self.subTest(text=text):
                self.assertEqual(off_platform_checks(text), [])


class OffPlatformLevelTests(unittest.TestCase):
    def test_any_off_platform_request_is_decisive_on_a_marketplace(self):
        for line in ["카톡 아이디 sale77 로 주문 주시면 할인해 드려요.", "계좌이체 시 5% 추가 할인됩니다."]:
            with self.subTest(line=line):
                result = assess_risk(listing(line), None, seller(), domain=MARKETPLACE, today=TODAY)
                self.assertEqual(result.level, "high")
                self.assertIn("마켓 밖", result.summary)

    def test_own_malls_are_judged_on_the_payment_only(self):
        cash = assess_risk(listing("계좌이체 시 5% 추가 할인됩니다."), None, seller(), domain=OWN_MALL, today=TODAY)
        self.assertEqual(cash.level, "moderate")
        self.assertIn("정상 결제 밖으로 유도하는 안내", cash.reasons)
        chat = assess_risk(listing("카톡 아이디 sale77 로 주문 주시면 할인해 드려요."), None, seller(), domain=OWN_MALL, today=TODAY)
        self.assertEqual(chat.level, "low")


class DomainFlagTests(unittest.TestCase):
    def test_reported_and_lookalike_domains(self):
        self.assertIn("LG전자 직영몰 사칭", domain_flags("https://lg-bestshop.com/")["reported_notice"])
        self.assertEqual(domain_flags("https://www.matinkim-kr.shop/p/1", include_reported=False), {"impersonates": "마뗑킴"})
        for official in ["https://www.lge.co.kr/", "https://www.samsung.com/sec/", "https://www.thenorthfacekorea.co.kr/",
                         "https://www.coupang.com/vp/products/1", "https://www.bluesky.co.kr/", "https://www.knownbose.com/"]:
            with self.subTest(official=official):
                self.assertEqual(domain_flags(official), {})

    def test_flags_hold_even_when_the_registry_lookup_fails(self):
        with patch("domain_check.httpx.get", side_effect=httpx.ConnectTimeout("timeout")):
            result = check_domain("https://ralphlauren-kr.shop/")
        self.assertEqual((result.status, result.impersonates), ("unavailable", "랄프로렌"))
        self.assertIsNotNone(result.reported_notice)

    def test_domain_flags_set_the_level_even_for_unread_pages(self):
        unread = RiskAnalysis(message="판매 페이지를 읽지 못했습니다")
        reported = DomainCheck(status="established", reported_notice="온라인쇼핑몰 울트라몰 주의")
        self.assertEqual(assess_risk(unread, None, domain=reported).level, "high")
        new_copy = DomainCheck(status="new", impersonates="우영미")
        self.assertEqual(assess_risk(unread, None, domain=new_copy).level, "high")
        old_copy = DomainCheck(status="established", impersonates="보스")
        result = assess_risk(unread, None, domain=old_copy)
        self.assertEqual(result.level, "moderate")
        self.assertIn("보스의 이름을 쓴 공식이 아닌 도메인", result.reasons)


if __name__ == "__main__":
    unittest.main()
