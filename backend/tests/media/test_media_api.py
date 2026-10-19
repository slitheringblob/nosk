"""Media upload tests."""

import hashlib

from fastapi.testclient import TestClient

from tests.conftest import User, add_component, make_page

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 100


def upload(
    user: User, data: bytes = PNG, mime: str = "image/png", checksum: str | None = None
) -> str:
    body = {"mime_type": mime, "file_size": len(data), "filename": "pic.png"}
    if checksum:
        body["checksum"] = checksum
    ticket = user.post("/api/media/upload-url", body)
    assert ticket.status_code == 200, ticket.text
    ticket = ticket.json()
    response = user.client.put(ticket["upload_url"], content=data, headers={"Content-Type": mime})
    assert response.status_code == 200, response.text
    return ticket["asset_id"]


def test_upload_and_download(alice: User) -> None:
    checksum = "sha256:" + hashlib.sha256(PNG).hexdigest()
    asset_id = upload(alice, checksum=checksum)
    response = alice.get(f"/api/media/{asset_id}")
    assert response.status_code == 200
    assert response.content == PNG
    assert response.headers["content-type"] == "image/png"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_upload_url_is_single_use_and_checks_size(alice: User, client: TestClient) -> None:
    ticket = alice.post("/api/media/upload-url", {"mime_type": "image/png", "file_size": 5}).json()
    assert client.put(ticket["upload_url"], content=b"123").status_code == 400
    assert client.put(ticket["upload_url"], content=b"12345").status_code == 200
    assert client.put(ticket["upload_url"], content=b"12345").status_code == 400


def test_checksum_mismatch(alice: User, client: TestClient) -> None:
    ticket = alice.post(
        "/api/media/upload-url",
        {"mime_type": "image/png", "file_size": 3, "checksum": "sha256:" + "0" * 64},
    ).json()
    assert client.put(ticket["upload_url"], content=b"abc").status_code == 400


def test_rejects_bad_types_sizes_and_tokens(alice: User, client: TestClient) -> None:
    bad_type = alice.post(
        "/api/media/upload-url", {"mime_type": "application/x-msdownload", "file_size": 10}
    )
    assert bad_type.status_code == 400
    too_big = alice.post("/api/media/upload-url", {"mime_type": "image/png", "file_size": 10**9})
    assert too_big.status_code == 400
    ticket = alice.post("/api/media/upload-url", {"mime_type": "image/png", "file_size": 3}).json()
    forged = ticket["upload_url"].split("?")[0] + "?token=forged"
    assert client.put(forged, content=b"abc").status_code == 403


def test_svg_is_served_as_attachment(alice: User) -> None:
    svg = b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"
    asset_id = upload(alice, svg, "image/svg+xml")
    response = alice.get(f"/api/media/{asset_id}")
    assert response.headers["content-type"] == "application/octet-stream"
    assert response.headers["content-disposition"].startswith("attachment")


def test_media_access_follows_page_sharing(alice: User, bob: User) -> None:
    asset_id = upload(alice)
    assert bob.get(f"/api/media/{asset_id}").status_code == 404
    page = make_page(alice)
    add_component(alice, page["id"], "image", {"asset_id": asset_id, "alt": "pic"})
    assert bob.get(f"/api/media/{asset_id}").status_code == 404
    alice.post(f"/api/pages/{page['id']}/shares", {"email": bob.email})
    assert bob.get(f"/api/media/{asset_id}").status_code == 200
