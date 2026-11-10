import pytest

from request_limits import reset_rate_limits


@pytest.fixture(autouse=True)
def fresh_rate_limits():
    # The limiter is process-wide; keep test order from tripping it.
    reset_rate_limits()
    yield
    reset_rate_limits()


@pytest.fixture(autouse=True)
def no_live_lookups(monkeypatch, tmp_path):
    # The local .env may hold real keys; tests that need one set a fake key themselves.
    monkeypatch.setenv("SERPER_API_KEY", "")
    monkeypatch.setenv("DATA_GO_KR_SERVICE_KEY", "")
    # Nor a locally built FTC index; tests that need one build it in a temporary folder.
    monkeypatch.setattr("mail_order_index.INDEX_PATH", tmp_path / "no-index.sqlite")
    # Nor the shipped FTC history; history tests point at a file they build.
    monkeypatch.setattr("seller_history.HISTORY_PATH", tmp_path / "no-history.sqlite")
    # Nor the domain registries; domain tests patch httpx in domain_check themselves.
    from schemas import DomainCheck
    monkeypatch.setattr("main.check_domain", lambda _url: DomainCheck())


@pytest.fixture(autouse=True)
def fresh_review_cache():
    # Identical material returns the cached review; one test's mocked answer must not reach the next.
    from risk_analysis import _CACHE
    _CACHE.clear()
    yield
    _CACHE.clear()


@pytest.fixture(autouse=True)
def no_lookup_cache(monkeypatch):
    # Tests reuse the same business numbers with different mocked answers.
    import lookup_cache
    lookup_cache._store.clear()
    monkeypatch.setattr(lookup_cache, "ENABLED", False)
