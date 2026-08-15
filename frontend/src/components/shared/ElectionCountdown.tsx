"use client";

/**
 * Countdown to the next scheduled election (or "Live" indicator when one is
 * currently happening). Reads from `/api/calendar/next`.
 *
 * Re-fetches every 60s; counts down once per second client-side without
 * re-hitting the API.
 */

import { useEffect, useState } from "react";

import { useApiData } from "@/hooks/useApiData";
import type { CalendarEvent } from "@/lib/api";

function format(secondsRemaining: number): { d: number; h: number; m: number; s: number } {
  const d = Math.floor(secondsRemaining / 86400);
  const h = Math.floor((secondsRemaining % 86400) / 3600);
  const m = Math.floor((secondsRemaining % 3600) / 60);
  const s = secondsRemaining % 60;
  return { d, h, m, s };
}

export default function ElectionCountdown() {
  const { data, error } = useApiData<CalendarEvent | null>("/api/calendar/next", 60_000);
  const initial = data?.seconds_until ?? null;
  const [remaining, setRemaining] = useState<number | null>(initial);

  useEffect(() => {
    setRemaining(initial);
  }, [initial]);

  useEffect(() => {
    if (remaining === null) return;
    const iv = setInterval(() => {
      setRemaining((cur) => (cur === null ? null : Math.max(0, cur - 1)));
    }, 1000);
    return () => clearInterval(iv);
  }, [remaining]);

  if (error) {
    return (
      <div className="rounded-lg border border-dashboard-border bg-dashboard-card p-4 text-sm text-dim">
        Calendar unavailable.
      </div>
    );
  }
  if (!data) {
    return (
      <div className="rounded-lg border border-dashboard-border bg-dashboard-card p-4 text-sm text-dim">
        No upcoming election scheduled. The scraper is idle.
      </div>
    );
  }

  // While an election is live, <LiveElectionPanel> owns the hero — it shows
  // the same "LIVE" framing plus reporting progress and running tallies.
  // Rendering both stacked two near-identical banners on polling day.
  if (data.status === "live") return null;

  const seconds = remaining ?? 0;
  const t = format(seconds);
  return (
    <div className="rounded-lg border border-dashboard-border bg-dashboard-card p-4">
      <div className="text-[11px] uppercase tracking-wider text-dim font-semibold">
        Next election
      </div>
      <div className="text-sm font-bold text-primary mt-1">
        {data.election_type_label}
        {data.state_name ? ` · ${data.state_name}` : ""}
        <span className="text-dim font-normal"> · {data.election_date}</span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        {(
          [
            ["Days", t.d],
            ["Hours", t.h],
            ["Min", t.m],
            ["Sec", t.s],
          ] as [string, number][]
        ).map(([label, value]) => (
          <div key={label} className="bg-black/20 rounded p-2">
            <div className="text-2xl font-mono font-extrabold text-primary tabular-nums">
              {String(value).padStart(2, "0")}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-dim">{label}</div>
          </div>
        ))}
      </div>
      {data.notes && <div className="text-[11px] text-dim mt-2 italic">{data.notes}</div>}
    </div>
  );
}
