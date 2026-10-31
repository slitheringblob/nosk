"""Fetch link-preview metadata (Open Graph) for bookmark blocks, with SSRF protection."""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import httpx

from app.utils.errors import APIError

MAX_BYTES = 512 * 1024
MAX_REDIRECTS = 3
TIMEOUT = httpx.Timeout(5.0)


class _MetaParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {k.lower(): (v or "") for k, v in attrs}
        if tag == "meta":
            key = (values.get("property") or values.get("name") or "").lower()
            if key and "content" in values and key not in self.meta:
                self.meta[key] = values["content"].strip()
        elif tag == "title":
            self._in_title = True
        elif tag == "link" and "icon" in values.get("rel", "").lower():
            self.meta.setdefault("icon", values.get("href", ""))

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title and len(self.title) < 300:
            self.title += data


async def _assert_public_host(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise APIError("Only http(s) URLs can be previewed")
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(
            parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM
        )
    except socket.gaierror as exc:
        raise APIError("Could not resolve host") from exc
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if not address.is_global or address.is_multicast:
            raise APIError("Refusing to fetch a private or reserved address")


async def unfurl(url: str) -> dict[str, str]:
    current = url
    async with httpx.AsyncClient(
        timeout=TIMEOUT, follow_redirects=False, headers={"User-Agent": "nosk-link-preview/1.0"}
    ) as client:
        for _ in range(MAX_REDIRECTS + 1):
            await _assert_public_host(current)
            async with client.stream("GET", current) as response:
                if response.is_redirect and response.headers.get("location"):
                    current = urljoin(current, response.headers["location"])
                    continue
                if response.status_code >= 400:
                    raise APIError(f"Site responded with HTTP {response.status_code}")
                if "html" not in response.headers.get("content-type", ""):
                    return {
                        "url": current,
                        "title": current,
                        "description": "",
                        "image_url": "",
                        "site_name": urlparse(current).hostname or "",
                    }
                body = b""
                async for chunk in response.aiter_bytes():
                    body += chunk
                    if len(body) >= MAX_BYTES:
                        break
                encoding = response.encoding or "utf-8"
                break
        else:
            raise APIError("Too many redirects")

    parser = _MetaParser()
    parser.feed(body.decode(encoding, errors="replace"))
    meta = parser.meta
    image = meta.get("og:image") or meta.get("twitter:image") or ""
    image = urljoin(current, image) if image else ""
    return {
        "url": current,
        "title": (meta.get("og:title") or meta.get("twitter:title") or parser.title).strip()[:300],
        "description": (meta.get("og:description") or meta.get("description") or "").strip()[:1000],
        "image_url": image if image.startswith(("http://", "https://")) else "",
        "site_name": (meta.get("og:site_name") or urlparse(current).hostname or "")[:200],
    }
