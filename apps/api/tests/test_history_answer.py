import json
import os
import unittest
from unittest.mock import MagicMock, patch

import httpx
from fastapi.testclient import TestClient

import main
from history_answer import market_of

ENV = {"SUPABASE_URL": "https://project.supabase.co", "SUPABASE_SECRET_KEY": "sb_secret_test", "OPENAI_API_KEY": "test-key"}
AUTH = {"Authorization": "Bearer user-token"}


def reply(status=200, body=None):
    response = MagicMock(status_code=status)
    response.json.return_value = body if body is not None else {}
    response.raise_for_status.side_effect = None if status < 400 else httpx.HTTPStatusError("x", request=None, response=None)
    return response


def row(index, url, name, level="low", label="낮음", score=100):
    return {"id": f"rec-{index}", "created_at": f"2026-11-2{index}T10:00:00Z", "product_url": url, "page_title": name,
            "product_name": name, "seller_name": f"판매자{index}", "price": "10970", "level": level, "label": label,
            "score": score, "summary": f"{name} 요약"}


def stored_result(label="낮음"):
    return {"product": {"brand_name": "로지텍", "product_name": "M170", "model_number": "M170", "price": "10970",
                        "currency": "KRW", "seller_name": "쿠팡", "components": ["마우스"]},
            "risk_analysis": {"status": "completed", "message": "완료", "assessment": {
                "level": "low", "label": label, "summary": "주의 신호를 찾지 못했습니다.", "reasons": ["쿠팡이 직접 판매"]}},
            "seller_verification": {"status": "platform_direct", "label": "쿠팡 직접 판매", "message": "마켓 직접 판매"}}


def completion(payload):
    message = MagicMock()
    message.content = json.dumps(payload, ensure_ascii=False)
    return MagicMock(choices=[MagicMock(message=message)])


@patch.dict(os.environ, ENV)
class HistoryQuestionTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)

    def get(self, rows, results):
        """Supabase: the token check, the summary list, then the picked results."""
        def handler(address, **_kwargs):
            if address.endswith("/auth/v1/user"):
                return reply(200, {"id": "user-1"})
            if "select=id,result" in address:
                return reply(200, results)
            return reply(200, rows)
        return handler

    def test_markets_are_named(self):
        self.assertEqual(market_of("https://m.gmarket.co.kr/vi/product/1"), "G마켓")
        self.assertEqual(market_of("https://mitem.auction.co.kr/vip?itemNo=1"), "옥션")
        self.assertEqual(market_of("https://www.coupang.com/vp/products/1"), "쿠팡")

    @patch("history_answer.OpenAI")
    @patch("httpx.get")
    def test_picked_records_are_cited_with_their_record(self, get, client):
        rows = [row(i, "https://www.coupang.com/vp/products/%d" % i, f"상품{i}") for i in range(1, 6)]
        rows[1]["product_url"] = "https://mitem.auction.co.kr/vip?itemNo=2"
        get.side_effect = self.get(rows, [{"id": "rec-1", "result": stored_result()}, {"id": "rec-2", "result": stored_result()}])
        client.return_value.chat.completions.create.side_effect = [
            completion({"records": ["r2", "R1", "R9"]}),
            completion({"answer": "쿠팡이 직접 판매해요.", "cited": ["E2", "E99"]})]
        response = self.client.post("/history-questions", json={"question": "쿠팡이랑 옥션 중 어디가 나았어?"}, headers=AUTH)
        body = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual([record["id"] for record in body["records"]], ["rec-2", "rec-1"])
        self.assertEqual(body["records"][0]["market"], "옥션")
        self.assertEqual([(c["id"], c["record_id"]) for c in body["citations"]], [("E2", "rec-2")])
        # Every Supabase read is held to the signed-in user's rows.
        reads = [call.args[0] for call in get.call_args_list if "/rest/v1/" in call.args[0]]
        self.assertEqual(len(reads), 2)
        self.assertTrue(all("user_id=eq.user-1" in address for address in reads))
        prompt = client.return_value.chat.completions.create.call_args_list[1].kwargs["messages"][1]["content"]
        self.assertIn("(R2) 기록 정보: 2026-11-22에 분석한 옥션", prompt)

    @patch("history_answer.OpenAI")
    @patch("httpx.get")
    def test_a_few_records_are_used_without_picking(self, get, client):
        get.side_effect = self.get([row(1, "https://www.coupang.com/vp/products/1", "M170")],
                                   [{"id": "rec-1", "result": stored_result()}])
        client.return_value.chat.completions.create.return_value = completion({"answer": "낮음이었어요.", "cited": ["E1"]})
        body = self.client.post("/history-questions", json={"question": "지난번 마우스 어땠어?"}, headers=AUTH).json()
        self.assertEqual(body["status"], "answered")
        self.assertEqual(client.return_value.chat.completions.create.call_count, 1)

    @patch("httpx.get")
    def test_no_records_is_said_plainly(self, get):
        get.side_effect = self.get([], [])
        body = self.client.post("/history-questions", json={"question": "기록 보여 줘"}, headers=AUTH).json()
        self.assertEqual(body["status"], "no_records")

    def test_a_question_needs_a_sign_in(self):
        self.assertEqual(self.client.post("/history-questions", json={"question": "기록 보여 줘"}).status_code, 401)


if __name__ == "__main__":
    unittest.main()
