"""Fixed-window, per-process rate limiting keyed by user (from the bearer token) or client IP.

Per-process state is fine for a single worker; multi-worker deployments should back this with a
shared store or enforce limits at the proxy.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import settings
from app.utils.errors import error_body
from app.utils.security import TokenError, decode_token

EXEMPT_PATHS = ("/api/health", "/docs", "/redoc", "/openapi.json")
WINDOW_SECONDS = 60


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app) -> None:  # type: ignore[no-untyped-def]
        super().__init__(app)
        self.windows: dict[str, tuple[int, int]] = {}

    def _identify(self, request: Request) -> tuple[str, int]:
        header = request.headers.get("authorization", "")
        if header.lower().startswith("bearer "):
            try:
                payload = decode_token(header[7:], "access")
                return f"user:{payload['sub']}", settings.rate_limit_authenticated_per_minute
            except TokenError:
                pass
        client = request.client.host if request.client else "unknown"
        return f"ip:{client}", settings.rate_limit_anonymous_per_minute

    def _prune(self, current_window: int) -> None:
        if len(self.windows) > 10_000:
            self.windows = {k: v for k, v in self.windows.items() if v[0] == current_window}

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        if (
            not settings.rate_limit_enabled
            or request.method == "OPTIONS"
            or request.url.path.startswith(EXEMPT_PATHS)
        ):
            return await call_next(request)

        key, limit = self._identify(request)
        now = time.time()
        window = int(now // WINDOW_SECONDS)
        self._prune(window)
        start, count = self.windows.get(key, (window, 0))
        if start != window:
            start, count = window, 0
        count += 1
        self.windows[key] = (start, count)
        reset = (window + 1) * WINDOW_SECONDS
        headers = {
            "X-RateLimit-Limit": str(limit),
            "X-RateLimit-Remaining": str(max(0, limit - count)),
            "X-RateLimit-Reset": str(reset),
        }
        if count > limit:
            headers["Retry-After"] = str(max(1, int(reset - now)))
            return JSONResponse(
                error_body("RATE_LIMIT_EXCEEDED", "Too many requests"), 429, headers=headers
            )
        response = await call_next(request)
        response.headers.update(headers)
        return response
