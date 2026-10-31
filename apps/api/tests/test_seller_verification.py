import os
import unittest
from unittest.mock import MagicMock, patch

import httpx

from seller_verification import extract_seller_info, is_valid_business_number, verify_seller

VALID = "123-45-67891"
NAVER_STYLE = """판매자 정보
상호명
주식회사 테스트메디
대표자
홍길동
사업자등록번호
123-45-67891
통신판매업번호
2020-서울강남-01234
사업장 소재지
서울특별시 강남구 테헤란로 1
고객센터
02-000-0000"""


def nts(record):
    response = MagicMock()
    response.json.return_value = {"status_code": "OK", "data": [record]}
    return response


class ExtractionTests(unittest.TestCase):
    def test_checksum(self):
        self.assertTrue(is_valid_business_number("1234567891"))
        self.assertTrue(is_valid_business_number("2208162517"))
        self.assertFalse(is_valid_business_number("1234567890"))
        self.assertFalse(is_valid_business_number("12345"))

    def test_reads_label_value_lines(self):
        seller = extract_seller_info(NAVER_STYLE)
        self.assertEqual(seller.business_name, "주식회사 테스트메디")
        self.assertEqual(seller.representative, "홍길동")
        self.assertEqual(seller.business_number, VALID)
        self.assertEqual(seller.mail_order_number, "2020-서울강남-01234")
        self.assertEqual(seller.address, "서울특별시 강남구 테헤란로 1")

    def test_reads_inline_disclosure(self):
        seller = extract_seller_info("상호: 테스트상사 | 대표자: 김철수 | 사업자등록번호: 1234567891 | "
                                     "통신판매업신고번호: 제2021-서울-0001호")
        self.assertEqual((seller.business_name, seller.representative, seller.business_number, seller.mail_order_number),
                         ("테스트상사", "김철수", VALID, "제2021-서울-0001호"))

    def test_one_line_paste_stops_at_the_description(self):
        seller = extract_seller_info("사업자등록번호 123-45-67891 | 통신판매업번호 2020-서울강남-01234. "
                                     "보습 크림 100ml. 사업장 소재지 서울시 강남구 1. 판매가 19,800원")
        self.assertEqual(seller.mail_order_number, "2020-서울강남-01234")
        self.assertEqual(seller.address, "서울시 강남구 1")

    def test_skips_marketplace_operator_registration(self):
        footer = "네이버(주) 대표이사 최수연 사업자등록번호 220-81-62517\n"
        self.assertIsNone(extract_seller_info(footer))
        self.assertEqual(extract_seller_info(footer + NAVER_STYLE).business_number, VALID)

    def test_unlabeled_numbers_are_ignored(self):
        self.assertIsNone(extract_seller_info("주문번호 123-45-67891 배송 조회"))


@patch.dict(os.environ, {"DATA_GO_KR_SERVICE_KEY": "test%2Bkey"})
class LookupTests(unittest.TestCase):
    def test_missing_number_and_key(self):
        self.assertEqual(verify_seller("상품 설명만 있습니다").status, "not_found")
        with patch.dict(os.environ, {"DATA_GO_KR_SERVICE_KEY": ""}):
            result = verify_seller(NAVER_STYLE)
        self.assertEqual(result.status, "unavailable")
        self.assertEqual(result.seller.business_number, VALID)

    @patch("seller_verification.httpx.post")
    def test_invalid_checksum_is_not_sent(self, post):
        result = verify_seller("사업자등록번호: 123-45-67890")
        self.assertEqual(result.status, "invalid_number")
        post.assert_not_called()

    @patch("seller_verification.httpx.post")
    def test_maps_nts_status_codes(self, post):
        cases = [({"b_stt_cd": "01", "tax_type": "부가가치세 일반과세자"}, "active"),
                 ({"b_stt_cd": "02"}, "suspended"),
                 ({"b_stt_cd": "03", "end_dt": "20240131"}, "closed"),
                 ({"b_stt_cd": "", "tax_type": "국세청에 등록되지 않은 사업자등록번호입니다."}, "unregistered"),
                 ({"b_stt_cd": "99"}, "unavailable")]
        for record, status in cases:
            with self.subTest(status=status):
                post.return_value = nts({"b_no": "1234567891", **record})
                result = verify_seller(NAVER_STYLE)
                self.assertEqual(result.status, status)
        self.assertEqual(result.seller.business_name, "주식회사 테스트메디")
        post.return_value = nts({"b_stt_cd": "03", "end_dt": "20240131"})
        self.assertEqual(verify_seller(NAVER_STYLE).closed_on, "2024-01-31")
        kwargs = post.call_args.kwargs
        self.assertEqual(kwargs["json"], {"b_no": ["1234567891"]})
        # A URL-encoded portal key is decoded once so httpx does not encode it twice.
        self.assertEqual(kwargs["params"]["serviceKey"], "test+key")

    @patch("seller_verification.httpx.post", side_effect=httpx.ConnectTimeout("timeout"))
    def test_network_failure_is_unavailable(self, _post):
        self.assertEqual(verify_seller(NAVER_STYLE).status, "unavailable")


if __name__ == "__main__":
    unittest.main()
