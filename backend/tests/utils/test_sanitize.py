"""HTML sanitizer tests."""

from app.utils.sanitize import html_to_text, sanitize_html, text_to_html


def test_keeps_allowed_inline_tags() -> None:
    value = "<strong>a</strong> <em>b</em> <del>c</del> <code>d</code> <mark>e</mark>"
    assert sanitize_html(value) == value


def test_normalises_browser_formatting_tags() -> None:
    assert sanitize_html("<b>x</b><i>y</i><strike>z</strike>") == (
        "<strong>x</strong><em>y</em><del>z</del>"
    )


def test_drops_scripts_and_event_handlers() -> None:
    dirty = '<img src=x onerror="alert(1)"><script>alert(2)</script><strong onclick="x">ok</strong>'
    assert sanitize_html(dirty) == "<strong>ok</strong>"


def test_rewrites_links_and_blocks_javascript_urls() -> None:
    assert sanitize_html('<a href="https://example.com">x</a>') == (
        '<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>'
    )
    assert sanitize_html('<a href=" javascript:alert(1)">x</a>') == "<a>x</a>"


def test_flattens_contenteditable_divs_to_breaks() -> None:
    assert sanitize_html("first<div>second</div><div>third</div>") == "first<br>second<br>third"


def test_closes_unbalanced_tags() -> None:
    assert sanitize_html("<strong>open") == "<strong>open</strong>"
    assert sanitize_html("stray</em>") == "stray"


def test_escapes_text() -> None:
    assert sanitize_html("1 < 2 & 3") == "1 &lt; 2 &amp; 3"


def test_text_round_trip() -> None:
    assert html_to_text("a<br><strong>b</strong>") == "a\nb"
    assert text_to_html("x <y>\nz") == "x &lt;y&gt;<br>z"
