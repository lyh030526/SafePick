import pytest

from request_limits import reset_rate_limits


@pytest.fixture(autouse=True)
def fresh_rate_limits():
    # The limiter is process-wide; keep test order from tripping it.
    reset_rate_limits()
    yield
    reset_rate_limits()


@pytest.fixture(autouse=True)
def no_live_lookups(monkeypatch):
    # The local .env may hold real keys; tests that need one set a fake key themselves.
    monkeypatch.setenv("SERPER_API_KEY", "")
    monkeypatch.setenv("DATA_GO_KR_SERVICE_KEY", "")
