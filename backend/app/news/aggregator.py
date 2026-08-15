"""Fetch, normalise, and cache the political news feed.

RSS is parsed with `defusedxml` (the one dependency this adds — the stdlib
parser is exposed to XXE and entity expansion on third-party documents),
Telegram is scraped from its public preview markup, and `requests` was
already a project dep.
"""

from __future__ import annotations

import html
import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any

import requests

# These are third-party documents fetched over the network. defusedxml closes
# XXE and entity-expansion ("billion laughs") against the stdlib parser; it
# exposes the same API, so parsing below is unchanged.
from defusedxml import ElementTree

from app.news.sources import Feed, SocialSource, all_feeds, all_social

log = logging.getLogger(__name__)

USER_AGENT = (
    "Mozilla/5.0 (compatible; NigeriaElectionDashboard/1.0; "
    "+https://elections.innoedgetech.com)"
)
FETCH_TIMEOUT = 10
CACHE_TTL_SECONDS = 300
MAX_PER_SOURCE = 15

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


@dataclass
class NewsItem:
    id: str
    title: str
    summary: str
    link: str
    source: str
    platform: str  # rss | telegram | x | facebook
    published_at: str | None
    relevance: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# ────────────────────────────────────────────────────────────────────────────
# Election relevance
# ────────────────────────────────────────────────────────────────────────────

# Scored, not filtered, so the caller decides how strict to be. The dashboard
# asks for election-relevant items on polling day and everything otherwise.
_STRONG_TERMS = (
    "inec", "irev", "polling unit", "collation", "returning officer",
    "ec8a", "bvas", "declared winner", "election result",
)
_MEDIUM_TERMS = (
    "election", "governorship", "gubernatorial", "poll", "ballot",
    "voter", "electorate", "candidate", "campaign", "constituency",
)


def election_relevance(text: str, *, focus: str | None = None) -> int:
    """Cheap keyword score. `focus` (e.g. a state name) weighs heaviest."""
    low = text.lower()
    score = 0
    if focus:
        focus_low = focus.lower()
        if focus_low in low:
            score += 10
    score += 4 * sum(1 for t in _STRONG_TERMS if t in low)
    score += 2 * sum(1 for t in _MEDIUM_TERMS if t in low)
    return score


# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────

def _strip_html(raw: str) -> str:
    if not raw:
        return ""
    text = raw.replace("<br>", " ").replace("<br/>", " ").replace("<br />", " ")
    text = _TAG_RE.sub(" ", text)
    text = html.unescape(text)
    return _WS_RE.sub(" ", text).strip()


def _parse_date(raw: str | None) -> str | None:
    """RSS dates are RFC 822; some feeds emit ISO 8601. Normalise to ISO UTC."""
    if not raw:
        return None
    raw = raw.strip()
    try:
        dt = parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).isoformat()


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT, "Accept": "*/*"})
    return s


# ────────────────────────────────────────────────────────────────────────────
# RSS
# ────────────────────────────────────────────────────────────────────────────

def _text(node: Any, *names: str) -> str:
    for name in names:
        found = node.find(name)
        if found is not None and found.text:
            return found.text
    return ""


def fetch_rss(feed: Feed, session: requests.Session) -> list[NewsItem]:
    resp = session.get(feed.url, timeout=FETCH_TIMEOUT)
    resp.raise_for_status()

    root = ElementTree.fromstring(resp.content)

    # RSS 2.0 puts items at channel/item; Atom uses a namespaced <entry>.
    entries = root.findall(".//item") or root.findall(
        ".//{http://www.w3.org/2005/Atom}entry"
    )

    items: list[NewsItem] = []
    for entry in entries[:MAX_PER_SOURCE]:
        title = _strip_html(
            _text(entry, "title", "{http://www.w3.org/2005/Atom}title")
        )
        if not title:
            continue

        link = _text(entry, "link", "guid")
        if not link:
            atom_link = entry.find("{http://www.w3.org/2005/Atom}link")
            if atom_link is not None:
                link = atom_link.get("href", "")

        summary = _strip_html(
            _text(
                entry,
                "description",
                "{http://purl.org/rss/1.0/modules/content/}encoded",
                "{http://www.w3.org/2005/Atom}summary",
            )
        )[:280]

        published = _parse_date(
            _text(
                entry,
                "pubDate",
                "{http://purl.org/dc/elements/1.1/}date",
                "{http://www.w3.org/2005/Atom}published",
                "{http://www.w3.org/2005/Atom}updated",
            )
        )

        items.append(
            NewsItem(
                id=f"rss-{abs(hash((feed.name, link or title)))}",
                title=title,
                summary=summary,
                link=link or "",
                source=feed.name,
                platform="rss",
                published_at=published,
            )
        )
    return items


# ────────────────────────────────────────────────────────────────────────────
# Telegram (no auth required)
# ────────────────────────────────────────────────────────────────────────────

_TG_POST_RE = re.compile(r'data-post="([^"]+)"')
_TG_TIME_RE = re.compile(r'<time datetime="([^"]+)"')
_TG_TEXT_RE = re.compile(r'tgme_widget_message_text[^>]*>([\s\S]*?)</div>')


def fetch_telegram(src: SocialSource, session: requests.Session) -> list[NewsItem]:
    resp = session.get(src.url, timeout=FETCH_TIMEOUT)
    resp.raise_for_status()

    blocks = resp.text.split('class="tgme_widget_message_wrap')[1:]
    items: list[NewsItem] = []
    for block in blocks:
        post = _TG_POST_RE.search(block)
        body = _TG_TEXT_RE.search(block)
        if not post or not body:
            continue  # media-only posts carry no text
        text = _strip_html(body.group(1))
        if not text:
            continue
        when = _TG_TIME_RE.search(block)
        items.append(
            NewsItem(
                id=f"tg-{post.group(1)}",
                title=text[:140],
                summary=text[:280],
                link=f"https://t.me/{post.group(1)}",
                source=src.name,
                platform="telegram",
                published_at=_parse_date(when.group(1) if when else None),
            )
        )
    return items[-MAX_PER_SOURCE:]


def fetch_rsshub(src: SocialSource, session: requests.Session) -> list[NewsItem]:
    import os

    base = os.environ.get("RSSHUB_URL", "").strip().rstrip("/")
    if not base:
        return []
    route = (
        f"{base}/twitter/user/{src.handle}"
        if src.platform == "x"
        else f"{base}/facebook/page/{src.handle}"
    )
    items = fetch_rss(Feed(src.name, route), session)
    for item in items:
        item.platform = src.platform
    return items


# ────────────────────────────────────────────────────────────────────────────
# Aggregation + cache
# ────────────────────────────────────────────────────────────────────────────

_cache: dict[str, Any] = {"at": 0.0, "items": []}
_cache_lock = threading.Lock()


def _collect() -> list[NewsItem]:
    session = _session()
    jobs: list[tuple[str, Any]] = [(f.name, (fetch_rss, f)) for f in all_feeds()]
    for src in all_social():
        fn = fetch_telegram if src.platform == "telegram" else fetch_rsshub
        jobs.append((f"{src.platform}:{src.handle}", (fn, src)))

    items: list[NewsItem] = []
    # Publishers are independent; one slow feed must not stall the rest.
    with ThreadPoolExecutor(max_workers=min(8, len(jobs) or 1)) as pool:
        futures = {pool.submit(fn, arg, session): label for label, (fn, arg) in jobs}
        for future in as_completed(futures):
            label = futures[future]
            try:
                items.extend(future.result())
            except Exception as exc:  # noqa: BLE001 - one bad source, not a bad feed
                log.warning("news: source %s failed: %s", label, exc)

    # De-duplicate on link — wires syndicate the same story across outlets.
    seen: set[str] = set()
    unique: list[NewsItem] = []
    for item in items:
        key = item.link or item.title
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)

    unique.sort(key=lambda i: i.published_at or "", reverse=True)
    return unique


def fetch_feed(*, force: bool = False) -> list[NewsItem]:
    """Cached aggregate feed. TTL keeps us polite to publishers under load."""
    now = time.monotonic()
    with _cache_lock:
        fresh = (now - _cache["at"]) < CACHE_TTL_SECONDS
        if fresh and _cache["items"] and not force:
            return list(_cache["items"])

    items = _collect()

    with _cache_lock:
        # Keep the last good payload if every source failed — a transient
        # upstream blip shouldn't blank the panel.
        if items or not _cache["items"]:
            _cache["items"] = items
            _cache["at"] = now
        else:
            log.warning("news: all sources failed, serving stale cache")
            items = list(_cache["items"])
    return items


def sources() -> dict[str, Any]:
    return {
        "rss": [{"name": f.name, "url": f.url} for f in all_feeds()],
        "social": [
            {"platform": s.platform, "handle": s.handle, "name": s.name, "url": s.url}
            for s in all_social()
        ],
        "cache_ttl_seconds": CACHE_TTL_SECONDS,
    }
