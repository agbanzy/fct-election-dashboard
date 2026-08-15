"""GET /api/news — aggregated political news + social posts.

Read-only passthrough over public feeds. Nothing here touches the database,
so it stays available even when the sync queue is saturated on polling day.
"""

from __future__ import annotations

from flask import Blueprint, jsonify, request

from app.news import aggregator

bp = Blueprint("news", __name__, url_prefix="/api/news")

MAX_LIMIT = 100


@bp.get("")
@bp.get("/")
def feed():
    """Merged feed, newest first.

    Query params:
      limit     — max items (default 30, hard cap 100)
      platform  — rss | telegram | x | facebook
      q         — substring match on title/summary
      focus     — state or topic to weight relevance by (e.g. "Osun")
      relevant  — "true" to drop items with no election signal
    """
    try:
        limit = min(int(request.args.get("limit", 30)), MAX_LIMIT)
    except ValueError:
        limit = 30
    limit = max(1, limit)

    platform = (request.args.get("platform") or "").strip().lower()
    query = (request.args.get("q") or "").strip().lower()
    focus = (request.args.get("focus") or "").strip() or None
    relevant_only = (request.args.get("relevant") or "").lower() == "true"

    items = aggregator.fetch_feed()

    out = []
    for item in items:
        if platform and item.platform != platform:
            continue
        haystack = f"{item.title} {item.summary}"
        if query and query not in haystack.lower():
            continue
        item.relevance = aggregator.election_relevance(haystack, focus=focus)
        if relevant_only and item.relevance == 0:
            continue
        out.append(item)

    # With a focus set, lead with what matters to it, then fall back to recency.
    if focus or relevant_only:
        out.sort(key=lambda i: (i.relevance, i.published_at or ""), reverse=True)

    return jsonify(
        {
            "count": len(out[:limit]),
            "total_available": len(items),
            "focus": focus,
            "items": [i.to_dict() for i in out[:limit]],
        }
    )


@bp.get("/sources")
def source_list():
    return jsonify(aggregator.sources())
