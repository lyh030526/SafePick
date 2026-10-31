import os
import unittest
from unittest.mock import MagicMock, patch

import httpx

from mail_order import check_mail_order
from schemas import SellerInfo, SellerVerification


def verification(name="소니코리아㈜", number="106-81-23810", report="확인 불가", status="active"):
    return SellerVerification(status=status, seller=SellerInfo(business_name=name, business_number=number,
                                                               mail_order_number=report))


def record(state="정상영업", name="소니코리아(주)", report="2012-서울영등포-1038", domain="www.sony.co.kr", brno="1068123810"):
    return {"brno": brno, "operSttusCdNm": state, "bzmnNm": name, "rprsvNm": "대표", "prmmiMnno": report, "domnCn": domain}


def ftc(*items):
    response = MagicMock()
    response.json.return_value = {"resultCode": "00", "totalCount": len(items), "items": list(items)}
    return response


SONY = "https://store.sony.co.kr/product-view/1"


@patch.dict(os.environ, {"DATA_GO_KR_SERVICE_KEY": "test%2Bkey"})
class MailOrderTests(unittest.TestCase):
    def test_nothing_to_look_up_without_a_number(self):
        self.assertIsNone(check_mail_order(SellerVerification(), SONY))
        self.assertIsNone(check_mail_order(verification(status="invalid_number"), SONY))

    @patch.dict(os.environ, {"DATA_GO_KR_SERVICE_KEY": ""})
    def test_missing_key_is_unavailable(self):
        self.assertEqual(check_mail_order(verification(), SONY).status, "unavailable")

    @patch("mail_order.httpx.get")
    def test_active_record_with_the_same_name_and_site_matches(self, get):
        # An old closed record of the same number does not count against the current one.
        get.return_value = ftc(record("폐업처리", report="2009-서울서초-0306", domain="N/A"), record())
        result = check_mail_order(verification(report="제2012-서울영등포-1038호"), SONY)
        self.assertEqual((result.status, result.registered_name, result.registered_domains),
                         ("matched", "소니코리아(주)", ["sony.co.kr"]))
        self.assertEqual(get.call_args.kwargs["params"]["brno"], "1068123810")
        self.assertEqual(get.call_args.kwargs["params"]["serviceKey"], "test+key")

    @patch("mail_order.httpx.get")
    def test_a_different_name_or_report_number_is_a_mismatch(self, get):
        get.return_value = ftc(record())
        self.assertEqual(check_mail_order(verification(name="해피굿즈샵"), SONY).status, "mismatch")
        self.assertEqual(check_mail_order(verification(report="2020-서울강남-0001"), SONY).status, "mismatch")

    @patch("mail_order.httpx.get")
    def test_without_a_name_label_the_registered_name_must_appear_on_the_page(self, get):
        get.return_value = ftc(record())
        footer = "사업자 등록번호 : 106-81-23810 통신판매번호 : 2012-서울영등포-1038 소니코리아㈜"
        self.assertEqual(check_mail_order(verification(name="확인 불가"), SONY, footer).status, "matched")
        self.assertEqual(check_mail_order(verification(name="확인 불가"), SONY, "사업자 등록번호 : 106-81-23810").status,
                         "name_absent")

    @patch("mail_order.httpx.get")
    def test_own_mall_on_another_domain_differs_but_marketplaces_do_not(self, get):
        get.return_value = ftc(record())
        self.assertEqual(check_mail_order(verification(), "https://sony-outlet-sale.shop/p/1").status, "domain_differs")
        self.assertEqual(check_mail_order(verification(), "https://smartstore.naver.com/a/products/1").status, "matched")
        get.return_value = ftc(record(domain="N/A"))
        self.assertEqual(check_mail_order(verification(), "https://sony-outlet-sale.shop/p/1").status, "matched")

    @patch("mail_order.httpx.get")
    def test_closed_or_missing_registration(self, get):
        get.return_value = ftc(record("폐업처리"), record("직권말소"))
        self.assertEqual(check_mail_order(verification(), SONY).status, "closed")
        get.return_value = ftc(record(brno="9999999999"))
        self.assertEqual(check_mail_order(verification(), SONY).status, "not_found")
        get.return_value = ftc()
        self.assertEqual(check_mail_order(verification(), SONY).status, "not_found")

    @patch("mail_order.httpx.get", side_effect=httpx.ConnectTimeout("timeout"))
    def test_network_failure_is_unavailable(self, _get):
        self.assertEqual(check_mail_order(verification(), SONY).status, "unavailable")


if __name__ == "__main__":
    unittest.main()
