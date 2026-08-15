"use client";

/**
 * Political news + social feed.
 *
 * Reads `/api/news`, which aggregates Nigerian newsroom RSS and public
 * Telegram channels server-side (cached, so this is cheap to poll).
 *
 * When `focus` is set — the live election's state on polling day — the
 * backend weights matching items to the top instead of showing raw recency.
 */

import { useState } from "react";

import { useApiData } from "@/hooks/useApiData";

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  link: string;
  source: string;
  platform: "rss" | "telegram" | "x" | "facebook";
  published_at: string | null;
  relevance: number;
}

interface NewsResponse {
  count: number;
  total_available: number;
  focus: string | null;
  items: NewsItem[];
}

const PLATFORM_STYLE: Record<string, { label: string; className: string }> = {
  rss: { label: "News", className: "bg-accent-blue/15 text-accent-blue" },
  telegram: { label: "Telegram", className: "bg-sky-500/15 text-sky-400" },
  x: { label: "X", className: "bg-white/10 text-primary" },
  facebook: { label: "Facebook", className: "bg-blue-600/20 text-blue-400" },
};

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function NewsFeed({
  focus = null,
  limit = 12,
  title = "Political news",
}: {
  focus?: string | null;
  limit?: number;
  title?: string;
}) {
  // `focus` arrives a tick late (it comes from /api/calendar/next), so seeding
  // useState with it would lock in the pre-load value of `false` and the
  // election-only default would never apply. Derive instead, and let an
  // explicit user choice win once one is made.
  const [override, setOverride] = useState<boolean | null>(null);
  const onlyRelevant = override ?? Boolean(focus);

  const qs = new URLSearchParams({ limit: String(limit) });
  if (focus) qs.set("focus", focus);
  if (onlyRelevant) qs.set("relevant", "true");

  // 3 min — the backend caches for 5, so this never stampedes publishers.
  const { data, error, isLoading } = useApiData<NewsResponse>(
    `/api/news?${qs}`,
    180_000,
  );

  return (
    <section className="rounded-lg border border-dashboard-border bg-dashboard-card p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-dim">
          {title}
          {focus && (
            <span className="ml-2 normal-case tracking-normal text-accent-green font-semibold">
              · {focus}
            </span>
          )}
        </h3>
        {focus && (
          <button
            type="button"
            onClick={() => setOverride(!onlyRelevant)}
            aria-pressed={onlyRelevant}
            className={`shrink-0 text-[11px] px-2 py-1 rounded border transition-colors ${
              onlyRelevant
                ? "border-accent-green/50 bg-accent-green/10 text-accent-green"
                : "border-dashboard-border text-dim hover:text-primary"
            }`}
          >
            {onlyRelevant ? "Election only" : "All politics"}
          </button>
        )}
      </div>

      {error && (
        <div className="text-[13px] text-dim italic">
          News feed unavailable. Results are unaffected.
        </div>
      )}

      {!error && isLoading && !data && (
        <div className="space-y-2" aria-hidden>
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-12 rounded bg-white/5 animate-pulse"
              style={{ animationDelay: `${i * 90}ms` }}
            />
          ))}
        </div>
      )}

      {!error && data && data.items.length === 0 && (
        <div className="text-[13px] text-dim italic">
          Nothing matching yet. Sources refresh every few minutes.
        </div>
      )}

      <ul className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
        {(data?.items || []).map((item) => {
          const style = PLATFORM_STYLE[item.platform] || PLATFORM_STYLE.rss;
          return (
            <li key={item.id}>
              <a
                href={item.link}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="block rounded border border-transparent hover:border-dashboard-border hover:bg-white/[0.03] px-2 py-2 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${style.className}`}
                  >
                    {style.label}
                  </span>
                  <span className="text-[11px] font-semibold text-dim truncate">
                    {item.source}
                  </span>
                  <span className="text-[11px] text-dim/70 ml-auto shrink-0">
                    {timeAgo(item.published_at)}
                  </span>
                </div>
                <div className="text-[13px] leading-snug text-primary">
                  {item.title}
                </div>
              </a>
            </li>
          );
        })}
      </ul>

      {data && data.items.length > 0 && (
        <div className="text-[10px] text-dim/70 mt-2 pt-2 border-t border-dashboard-border">
          Headlines from independent Nigerian newsrooms, linked to source.
          Reporting is not verified results — see the official INEC figures above.
        </div>
      )}
    </section>
  );
}
