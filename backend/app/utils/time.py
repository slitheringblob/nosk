"""Time helpers. All persisted timestamps are Unix epoch milliseconds."""

from __future__ import annotations

import time


def now_ms() -> int:
    return int(time.time() * 1000)
