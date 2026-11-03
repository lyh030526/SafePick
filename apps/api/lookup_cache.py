"""A day-long memory of outside lookups (NTS status, FTC registration, shopping search). The same seller or product is
often analyzed again, and every page of a same-product comparison asks for the same price, so a repeat costs nothing.
Only successful answers are kept; a failed call is tried again next time."""
import time
from collections import OrderedDict
from collections.abc import Callable

TTL_SECONDS = 24 * 3600
# Tests answer the same number with different mocked replies, so they switch the memory off.
ENABLED = True
_SIZE = 2048
_store: "OrderedDict[tuple[str, str], tuple[float, object]]" = OrderedDict()


def cached(kind: str, key: str, fetch: Callable[[], object]):
    if not ENABLED:
        return fetch()
    entry = _store.get((kind, key))
    if entry and time.time() - entry[0] < TTL_SECONDS:
        _store.move_to_end((kind, key))
        return entry[1]
    value = fetch()
    _store[(kind, key)] = (time.time(), value)
    while len(_store) > _SIZE:
        _store.popitem(last=False)
    return value
