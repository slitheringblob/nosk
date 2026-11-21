"""API error types and the handlers that render the standard error envelope."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class APIError(Exception):
    status_code = 400
    code = "BAD_REQUEST"

    def __init__(
        self,
        message: str,
        details: list[dict[str, Any]] | None = None,
        status_code: int | None = None,
        code: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or []
        if status_code is not None:
            self.status_code = status_code
        if code is not None:
            self.code = code


class ValidationFailed(APIError):
    status_code = 422
    code = "VALIDATION_ERROR"


class AuthenticationFailed(APIError):
    status_code = 401
    code = "AUTHENTICATION_ERROR"


class Forbidden(APIError):
    status_code = 403
    code = "AUTHORIZATION_ERROR"


class NotFound(APIError):
    status_code = 404
    code = "NOT_FOUND"


class Conflict(APIError):
    status_code = 400
    code = "CONFLICT"


class AlreadyExists(APIError):
    """An entity with the client-supplied id exists (possibly created by a concurrent request)."""

    status_code = 400
    code = "CONFLICT"


class RateLimited(APIError):
    status_code = 429
    code = "RATE_LIMIT_EXCEEDED"


STATUS_CODES = {
    400: "BAD_REQUEST",
    401: "AUTHENTICATION_ERROR",
    403: "AUTHORIZATION_ERROR",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    413: "PAYLOAD_TOO_LARGE",
    422: "VALIDATION_ERROR",
    429: "RATE_LIMIT_EXCEEDED",
}


def error_body(code: str, message: str, details: list[dict[str, Any]] | None = None) -> dict:
    return {"error": {"code": code, "message": message, "details": details or []}}


def _validation_details(exc: RequestValidationError) -> list[dict[str, Any]]:
    details = []
    for error in exc.errors():
        location = [str(part) for part in error.get("loc", []) if part not in ("body", "query")]
        details.append({"field": ".".join(location) or None, "message": error.get("msg", "")})
    return details


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(APIError)
    async def handle_api_error(_request: Request, exc: APIError) -> JSONResponse:
        headers = {"WWW-Authenticate": "Bearer"} if exc.status_code == 401 else None
        return JSONResponse(
            error_body(exc.code, exc.message, exc.details), exc.status_code, headers=headers
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation(_request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            error_body("VALIDATION_ERROR", "Invalid request data", _validation_details(exc)), 422
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = STATUS_CODES.get(exc.status_code, "SERVER_ERROR")
        return JSONResponse(error_body(code, str(exc.detail)), exc.status_code)

    @app.exception_handler(Exception)
    async def handle_unexpected(_request: Request, _exc: Exception) -> JSONResponse:
        return JSONResponse(error_body("SERVER_ERROR", "Internal server error"), 500)
