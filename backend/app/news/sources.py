"""Source registry for the political news feed.

Deliberately newsroom-only. The upstream aggregator this was ported from
carried party channels (APC, @officialABAT); a results dashboard that
publishes INEC numbers cannot also surface one party's press feed without
inviting a fair reading that the results are partisan too. Anyone who wants
party feeds can add them via NEWS_EXTRA_FEEDS rather than having them baked in.

Override the defaults with env vars, both comma-separated:
    NEWS_EXTRA_FEEDS   = "Name|https://example.com/feed, ..."
    NEWS_EXTRA_SOCIAL  = "telegram|handle|Display Name, ..."
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Feed:
    name: str
    url: str


@dataclass(frozen=True)
class SocialSource:
    platform: str  # telegram | x | facebook
    handle: str
    name: str

    @property
    def url(self) -> str:
        if self.platform == "telegram":
            return f"https://t.me/s/{self.handle}"
        if self.platform == "x":
            return f"https://x.com/{self.handle}"
        return f"https://facebook.com/{self.handle}"


# Verified live 2026-08-15. The upstream aggregator's Premium Times URL
# (/category/news/political-news/feed) quietly returns an HTML page rather
# than XML — it had been silently contributing nothing.
#
# Deliberately absent: The Nation, TheCable and Channels TV all sit behind a
# Cloudflare bot challenge on their feed URLs. Getting past that means
# defeating bot detection, which we don't do — TheCable is covered via its
# public Telegram channel below instead.
RSS_FEEDS: list[Feed] = [
    Feed("Punch", "https://punchng.com/topics/politics/feed/"),
    Feed("Premium Times", "https://www.premiumtimesng.com/category/news/politics/feed"),
    Feed("Daily Post", "https://dailypost.ng/category/politics/feed/"),
    Feed("Vanguard", "https://www.vanguardngr.com/category/politics/feed/"),
    Feed("Tribune", "https://tribuneonlineng.com/category/politics/feed/"),
    Feed("ThisDay", "https://www.thisdaylive.com/index.php/category/politics/feed/"),
    Feed("The Sun", "https://www.sunnewsonline.com/category/politics/feed/"),
    Feed("Legit.ng", "https://www.legit.ng/rss/all.rss"),
]

SOCIAL_SOURCES: list[SocialSource] = [
    # Telegram needs no credentials — public channels render server-side.
    SocialSource("telegram", "legitng", "Legit.ng"),
    SocialSource("telegram", "TheCableNG", "TheCable"),
    SocialSource("telegram", "premiumtimes", "Premium Times"),
    # Requires RSSHUB_URL; skipped cleanly when unset.
    SocialSource("x", "inecnigeria", "INEC Nigeria"),
    SocialSource("x", "channelstv", "Channels TV"),
]


def _parse_extra_feeds(raw: str) -> list[Feed]:
    out: list[Feed] = []
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk or "|" not in chunk:
            continue
        name, _, url = chunk.partition("|")
        if name.strip() and url.strip().startswith("http"):
            out.append(Feed(name.strip(), url.strip()))
    return out


def _parse_extra_social(raw: str) -> list[SocialSource]:
    out: list[SocialSource] = []
    for chunk in raw.split(","):
        parts = [p.strip() for p in chunk.split("|")]
        if len(parts) != 3:
            continue
        platform, handle, name = parts
        if platform in ("telegram", "x", "facebook") and handle and name:
            out.append(SocialSource(platform, handle, name))
    return out


def all_feeds() -> list[Feed]:
    return RSS_FEEDS + _parse_extra_feeds(os.environ.get("NEWS_EXTRA_FEEDS", ""))


def all_social() -> list[SocialSource]:
    configured = SOCIAL_SOURCES + _parse_extra_social(os.environ.get("NEWS_EXTRA_SOCIAL", ""))
    has_rsshub = bool(os.environ.get("RSSHUB_URL", "").strip())
    return [s for s in configured if s.platform == "telegram" or has_rsshub]
