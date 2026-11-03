import unittest
from unittest.mock import MagicMock, patch

import httpx

import lookup_cache
from lookup_cache import cached


class LookupCacheTests(unittest.TestCase):
    @patch.object(lookup_cache, "ENABLED", True)
    def test_a_repeat_lookup_is_answered_from_memory_but_failures_are_not_kept(self):
        fetch = MagicMock(side_effect=[httpx.ConnectTimeout("t"), {"b_stt_cd": "01"}])
        with self.assertRaises(httpx.ConnectTimeout):
            cached("nts", "1234567891", fetch)
        self.assertEqual(cached("nts", "1234567891", fetch), {"b_stt_cd": "01"})
        self.assertEqual(cached("nts", "1234567891", fetch), {"b_stt_cd": "01"})
        self.assertEqual(fetch.call_count, 2)
        with patch.object(lookup_cache.time, "time", return_value=lookup_cache.time.time() + lookup_cache.TTL_SECONDS + 1):
            fetch.side_effect = [{"b_stt_cd": "03"}]
            self.assertEqual(cached("nts", "1234567891", fetch), {"b_stt_cd": "03"})


if __name__ == "__main__":
    unittest.main()
