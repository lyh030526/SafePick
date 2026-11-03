import os
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

import httpx

import main

ENV = {"SUPABASE_URL": "https://project.supabase.co", "SUPABASE_SECRET_KEY": "sb_secret_test"}


def reply(status=200, body=None):
    response = MagicMock(status_code=status)
    response.json.return_value = body or {}
    response.raise_for_status.side_effect = None if status < 400 else httpx.HTTPStatusError("x", request=None, response=None)
    return response


class AccountDeletionTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)

    @patch.dict(os.environ, ENV)
    @patch("accounts.httpx.delete", return_value=reply(200))
    @patch("accounts.httpx.get", return_value=reply(200, {"id": "user-1"}))
    def test_the_signed_in_user_is_deleted_with_the_server_key(self, get, delete):
        response = self.client.delete("/account", headers={"Authorization": "Bearer user-token"})
        self.assertEqual((response.status_code, response.json()), (200, {"status": "deleted"}))
        self.assertEqual(get.call_args.kwargs["headers"]["Authorization"], "Bearer user-token")
        self.assertEqual(delete.call_args.args[0], "https://project.supabase.co/auth/v1/admin/users/user-1")
        self.assertEqual(delete.call_args.kwargs["headers"]["Authorization"], "Bearer sb_secret_test")

    @patch.dict(os.environ, ENV)
    @patch("accounts.httpx.delete")
    @patch("accounts.httpx.get", return_value=reply(401))
    def test_a_rejected_token_deletes_nothing(self, _get, delete):
        self.assertEqual(self.client.delete("/account", headers={"Authorization": "Bearer forged"}).status_code, 401)
        self.assertEqual(self.client.delete("/account").status_code, 401)
        delete.assert_not_called()

    @patch.dict(os.environ, {"SUPABASE_URL": "", "SUPABASE_SECRET_KEY": ""})
    def test_without_the_server_key_it_is_unavailable(self):
        self.assertEqual(self.client.delete("/account", headers={"Authorization": "Bearer t"}).status_code, 503)


if __name__ == "__main__":
    unittest.main()
