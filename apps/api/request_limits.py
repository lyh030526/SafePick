import os
import threading
import time
from collections import defaultdict, deque

from fastapi.responses import JSONResponse


BODY_LIMITS = {
    "/analyses": (12 * 1024 * 1024, "첨부 자료가 너무 큽니다. 이미지 크기나 개수를 줄여 주세요."),
    "/comparisons": (256 * 1024, "비교 요청이 너무 큽니다. 상품 설명을 줄여 주세요."),
    "/group-analyses": (1024 * 1024, "비교할 판매 페이지 내용이 너무 큽니다. 페이지 수를 줄여 주세요."),
}
RATE_LIMITED_PATHS = set(BODY_LIMITS)
RATE_WINDOW_SECONDS = 60.0

_rate_lock = threading.Lock()
_rate_hits: dict[str, deque[float]] = defaultdict(deque)


def reset_rate_limits() -> None:
    with _rate_lock:
        _rate_hits.clear()


def _rate_limited(client: str, limit: int) -> bool:
    now = time.monotonic()
    with _rate_lock:
        hits = _rate_hits[client]
        while hits and now - hits[0] >= RATE_WINDOW_SECONDS:
            hits.popleft()
        if len(hits) >= limit:
            return True
        hits.append(now)
        return False


class AnalysisRateLimit:
    """Bound paid AI/search calls per client IP. In-memory: one process, resets on restart."""

    def __init__(self, app, per_minute=None):
        self.app = app
        self.per_minute = per_minute if per_minute is not None else int(os.getenv("SAFEPICK_RATE_LIMIT_PER_MINUTE", "30"))

    async def __call__(self, scope, receive, send):
        if (scope["type"] != "http" or scope.get("method") != "POST"
                or scope.get("path") not in RATE_LIMITED_PATHS or self.per_minute <= 0):
            return await self.app(scope, receive, send)
        client = (scope.get("client") or ("unknown", 0))[0]
        if _rate_limited(client, self.per_minute):
            response = JSONResponse(status_code=429, headers={"Retry-After": "60"},
                                    content={"detail": "요청이 너무 많습니다. 1분 후 다시 시도해 주세요."})
            return await response(scope, receive, send)
        return await self.app(scope, receive, send)


class AnalysisBodyLimit:
    """Bound the actual body, including chunked uploads, before JSON/base64 parsing."""

    def __init__(self, app, limits=None):
        self.app = app
        self.limits = limits or BODY_LIMITS

    async def __call__(self, scope, receive, send):
        limit = self.limits.get(scope.get("path")) if scope["type"] == "http" and scope.get("method") == "POST" else None
        if limit is None:
            return await self.app(scope, receive, send)
        max_bytes, message_text = limit
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            if len(body) + len(chunk) > max_bytes:
                response = JSONResponse(status_code=413, content={"detail": message_text})
                return await response(scope, receive, send)
            body.extend(chunk)
            if not message.get("more_body", False):
                break
        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        return await self.app(scope, replay, send)
