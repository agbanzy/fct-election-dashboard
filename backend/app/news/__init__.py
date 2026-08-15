"""Political news + social aggregation.

Ported from the standalone Politics News Aggregator. Three source classes:

  * RSS  — Nigerian newsroom politics feeds, parsed from raw XML.
  * Telegram — public channels expose a preview page at `t.me/s/<handle>`
    that needs no auth or API key.
  * X / Facebook — no public feed; routed through an RSSHub instance when
    `RSSHUB_URL` is configured, skipped silently otherwise.

Everything is best-effort: a source that times out or changes its markup
yields nothing and the rest of the feed still renders. Results are cached
in-process so a burst of dashboard traffic doesn't hammer publishers.
"""

from app.news.aggregator import (
    NewsItem,
    election_relevance,
    fetch_feed,
    sources,
)

__all__ = ["NewsItem", "election_relevance", "fetch_feed", "sources"]
