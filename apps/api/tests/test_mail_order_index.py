import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from mail_order_index import build, find_number
from seller_verification import verify_seller

HEADER = "통신판매번호,신고기관명,상호,사업자등록번호,법인여부,대표자명,업소상태,인터넷도메인\n"
ROWS = [
    "2012-서울영등포-1038,영등포구,소니코리아(주),106-81-23810,법인,KITAJIMA YUKIHIRO,정상영업,www.sony.co.kr",
    "2009-서울서초-0306,서초구,소니코리아(주),106-81-23810,법인,KITAJIMA YUKIHIRO,폐업,N/A",
    "2020-서울강남-0001,강남구,같은상점,111-11-11111,개인,김동명,정상영업,N/A",
    "2021-부산중구-0002,중구,같은상점,222-22-22222,개인,김동명,정상영업,N/A",
    "2022-서울마포-0003,마포구,문을닫은가게,333-33-33333,개인,이폐업,폐업,N/A",
    # A comma inside a value shifts the row: left out rather than tied to a wrong number.
    "2023-서울종로-0004,종로구,밀린상점,444-44-44444,개인,박밀림,인터넷,정상영업,N/A",
]


class IndexTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        folder = Path(self.folder.name)
        # Region files come in either encoding.
        (folder / "seoul.csv").write_text(HEADER + "\n".join(ROWS[:3]) + "\n", encoding="cp949")
        (folder / "busan.csv").write_text(HEADER + "\n".join(ROWS[3:]) + "\n", encoding="utf-8-sig")
        self.index = folder / "index.sqlite"
        self.assertEqual(build([folder / "seoul.csv", folder / "busan.csv"], self.index), 5)

    def test_unique_operating_registration_gives_the_number(self):
        self.assertEqual(find_number("소니코리아㈜", "KITAJIMA YUKIHIRO", self.index), "1068123810")

    def test_ambiguous_closed_or_unknown_gives_nothing(self):
        self.assertIsNone(find_number("같은상점", "김동명", self.index))
        self.assertIsNone(find_number("문을닫은가게", "이폐업", self.index))
        self.assertIsNone(find_number("밀린상점", "박밀림", self.index))
        self.assertIsNone(find_number("소니코리아(주)", "다른사람", self.index))
        self.assertIsNone(find_number("소니코리아(주)", "", self.index))
        self.assertIsNone(find_number("소니코리아(주)", "KITAJIMA YUKIHIRO", self.index.with_name("missing.sqlite")))

    @patch.dict(os.environ, {"DATA_GO_KR_SERVICE_KEY": "test-key"})
    @patch("seller_verification.httpx.post")
    def test_marketplace_seller_is_checked_with_the_found_number(self, post):
        post.return_value = MagicMock(json=MagicMock(return_value={"data": [{"b_no": "1068123810", "b_stt_cd": "01"}]}))
        naver = "판매자 정보:\n상호명\n소니코리아(주)\n대표자\nKITAJIMA YUKIHIRO"
        with patch("mail_order_index.INDEX_PATH", self.index):
            result = verify_seller(naver, "https://brand.naver.com/sonystore/products/1")
        self.assertEqual((result.status, result.number_source, result.seller.business_number),
                         ("active", "registry", "106-81-23810"))
        self.assertEqual(post.call_args.kwargs["json"], {"b_no": ["1068123810"]})
        # Flattened text runs the representative into the next sentence; the leading words still match.
        flat = "판매자정보 테이블 판매자 같은상점 상호명 소니코리아(주) 사업자구분 법인 대표자 KITAJIMA YUKIHIRO 11번가 결제대금예치업 등록번호"
        with patch("mail_order_index.INDEX_PATH", self.index):
            result = verify_seller(flat, "https://www.11st.co.kr/products/1")
        self.assertEqual((result.number_source, result.seller.representative), ("registry", "KITAJIMA YUKIHIRO"))


if __name__ == "__main__":
    unittest.main()
