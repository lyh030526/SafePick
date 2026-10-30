import pytest

from request_limits import reset_rate_limits


@pytest.fixture(autouse=True)
def fresh_rate_limits():
    # The limiter is process-wide; keep test order from tripping it.
    reset_rate_limits()
    yield
    reset_rate_limits()
