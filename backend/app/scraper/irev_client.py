"""Thin HTTP client for the INEC IReV API.

Backend: `https://dolphin-app-sleqh.ondigitalocean.app/api/v1/` — this is INEC's
own DO-hosted API (not a third-party proxy). Verified by inspecting the official
SPA at https://www.inecelectionresults.ng — its main.js bundle references the
same host, the same `x-api-key` value, and a sibling base at
`https://lv001-r.inecelectionresults.ng/api/v1/`.

The "API key" is INEC's PUBLIC client key, shipped in the SPA bundle. It is not
a secret. Empirically the server doesn't even enforce it — calls succeed
without the header — but we send it for compatibility / future-proofing in case
INEC starts enforcing.

Retries on 429/5xx with backoff. Token bucket caps to 30 req/min.
"""

from __future__ import annotations

import contextlib
import logging
import threading
import time
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

log = logging.getLogger(__name__)

# INEC's PUBLIC Angular client key, baked into their SPA bundle. Not a secret —
# served to every browser that opens inecelectionresults.ng. Empirically the
# server does not enforce it; sent for compatibility.
PUBLIC_INEC_CLIENT_KEY = "4SXkHM7Amb1SbF4C8do6816dmbbwqPp7akRbrmcV"

_DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://www.inecelectionresults.ng",
    "Referer": "https://www.inecelectionresults.ng/",
    "Connection": "keep-alive",
}


class TokenBucket:
    """Simple thread-safe token bucket. Default: 30 tokens / 60s."""

    def __init__(self, capacity: int = 30, refill_seconds: float = 60.0) -> None:
        self.capacity = capacity
        self.tokens = float(capacity)
        self.refill_rate = capacity / refill_seconds
        self.last = time.monotonic()
        self._lock = threading.Lock()

    def acquire(self, count: int = 1) -> None:
        while True:
            with self._lock:
                now = time.monotonic()
                elapsed = now - self.last
                self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_rate)
                self.last = now
                if self.tokens >= count:
                    self.tokens -= count
                    return
                wait = (count - self.tokens) / self.refill_rate
            time.sleep(min(wait, 2.0))


class IrevClient:
    def __init__(
        self,
        base_url: str,
        api_key: str | None = None,
        *,
        requests_per_minute: int = 30,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        # Caller may override via env (e.g. INEC rotates the public key); otherwise
        # use the published one. Pass empty string to actively suppress the header.
        self.api_key = PUBLIC_INEC_CLIENT_KEY if api_key is None else api_key
        self.bucket = TokenBucket(capacity=requests_per_minute, refill_seconds=60.0)
        self._session = requests.Session()

        # Election night is exactly when IReV gets slow, and exactly when we
        # can least afford to wait: total=4 + backoff_factor=5 against a 90s
        # read timeout blocks a single call for ~6.6 minutes, which wedges the
        # whole daemon tick behind one unlucky ward. Every phase here is
        # re-entrant, so failing fast and picking the work up next cycle beats
        # retrying patiently in-line.
        retries = Retry(
            total=2,
            backoff_factor=1,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["GET"],
            raise_on_status=False,
        )
        adapter = HTTPAdapter(
            max_retries=retries, pool_connections=10, pool_maxsize=10, pool_block=False
        )
        self._session.mount("https://", adapter)
        self._session.mount("http://", adapter)
        self._session.headers.update(_DEFAULT_HEADERS)
        if self.api_key:
            self._session.headers["x-api-key"] = self.api_key

    def get(self, path: str, *, timeout: int = 90, params: dict[str, Any] | None = None) -> Any:
        self.bucket.acquire()
        url = f"{self.base_url}/{path.lstrip('/')}"
        self._session.headers["x-api-rt"] = str(int(time.time() * 1000))
        log.debug("GET %s params=%s", url, params)
        resp = self._session.get(url, params=params, timeout=timeout)
        resp.raise_for_status()
        if not resp.content:
            return None
        body = resp.json()
        # Best-effort: write to local cache table. Failure here is non-fatal
        # — caching is an optimization, not a correctness requirement.
        with contextlib.suppress(Exception):
            self._maybe_cache(url, params, resp.status_code, body)
        return body

    def _maybe_cache(
        self,
        url: str,
        params: dict[str, Any] | None,
        status: int,
        body: Any,
    ) -> None:
        # Lazy import to avoid pulling DB into pure HTTP test paths.
        import hashlib
        import json as _json

        from sqlalchemy.dialects.postgresql import insert

        from app.db import session_scope
        from app.models import IrevRawCache

        canonical = url + ("?" + _json.dumps(params, sort_keys=True) if params else "")
        url_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()

        with session_scope() as session:
            stmt = insert(IrevRawCache).values(
                url_hash=url_hash,
                url=canonical[:1000],
                status_code=status,
                body=body if isinstance(body, dict | list) else None,
            )
            # Upsert on conflict (url_hash unique).
            stmt = stmt.on_conflict_do_update(
                index_elements=["url_hash"],
                set_={
                    "status_code": stmt.excluded.status_code,
                    "body": stmt.excluded.body,
                    "fetched_at": __import__("sqlalchemy").func.now(),
                },
            )
            session.execute(stmt)

    def list_elections(self, *, election_type_id: str) -> Any:
        return self.get("/elections", params={"election_type": election_type_id})

    def election_stats(self, election_id: str) -> Any:
        return self.get(f"/elections/{election_id}/result/stats")

    def lga_state(self, election_id: str, state_id: int) -> Any:
        return self.get(f"/elections/{election_id}/lga/state/{state_id}")

    def pus_for_ward(self, election_id: str, ward_id: str) -> Any:
        """Polling units for one ward.

        `ward_id` must be the ward's Mongo `_id`; the integer ward_id is
        rejected with a 400.

        Tight timeout on purpose: this is the highest-volume call in the walk
        (one per ward, 332 for Osun alone) and the first to degrade when INEC
        is under load. The payload is small, so a slow response means an
        overloaded upstream, not a big transfer — drop it and take the ward
        again next tick rather than holding the daemon.
        """
        return self.get(
            f"/elections/{election_id}/pus", params={"ward": ward_id}, timeout=25
        )
