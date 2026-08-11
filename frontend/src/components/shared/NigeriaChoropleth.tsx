"use client";

/**
 * Nigeria state choropleth. Defaults to coloring by the 2023 Presidential
 * winner per state. Users can pick another (cycle, type) combo.
 *
 * Falls back to per-state grid below the map.
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useApiData } from "@/hooks/useApiData";
import type { StateRow } from "@/lib/api";

// CBM Connect (cbmnigeria.org) exposes a public, CORS-open grassroots-coverage
// feed. Overriding the base is handy for staging.
const CBM_API = process.env.NEXT_PUBLIC_CBM_API || "https://cbmnigeria.org";

interface CbmStateCoverage {
  code: string;
  name: string;
  members: number;
  activeMembers: number;
  lgaCount: number;
  wardCount: number;
  wardsWithMembers: number;
  hasStateDirector: boolean;
  wardsWithLeader: number;
  wardLeaderPct: number;
}

/** Rows from CBM's support-group activity feed — the same endpoint that colours
 *  the internal dashboard's map, so both surfaces agree on "how active is here". */
interface SgActivity {
  code: string;
  name: string;
  members: number;
  newMembers: number;
  events: number;
  groups: number;
  reports: number;
  score: number;
  level: "high" | "moderate" | "attention";
}

const LeafletMap = dynamic(() => import("./NigeriaLeafletMap"), {
  ssr: false,
  loading: () => (
    <div className="rounded-lg border border-dashboard-border bg-dashboard-card p-8 text-center text-sm text-dim">
      Loading map…
    </div>
  ),
});

interface Winner {
  state_code: string;
  state_name: string;
  winner_party_code: string;
  winner_party_color: string | null;
  winner_candidate: string | null;
  winner_votes: number;
  winner_share: number;
  margin: number | null;
  total_votes: number;
}

interface WinnersResp {
  [code: string]: Winner;
}

interface Pick {
  label: string;
  cycle: number;
  type: string;
  date: string; // ISO election date — used to sort newest-first
}

// Sorted newest-first so the landing/dashboard map opens on the CURRENT
// election (the live Ekiti governorship) rather than an old default.
const COMMON_PICKS: Pick[] = [
  { label: "2026 Governorship", cycle: 2026, type: "governorship", date: "2026-06-20" },
  { label: "2026 LG Chairman", cycle: 2026, type: "lg_chairman", date: "2026-02-21" },
  { label: "2024 Governorship", cycle: 2024, type: "governorship", date: "2024-11-16" },
  { label: "2023 Governorship", cycle: 2023, type: "governorship", date: "2023-03-18" },
  { label: "2023 Presidential", cycle: 2023, type: "presidential", date: "2023-02-25" },
]
  .slice()
  .sort((a, b) => b.date.localeCompare(a.date));

const ZONE_COLORS: Record<string, string> = {
  NC: "bg-emerald-500/10 border-emerald-500/30",
  NE: "bg-orange-500/10 border-orange-500/30",
  NW: "bg-blue-500/10 border-blue-500/30",
  SE: "bg-purple-500/10 border-purple-500/30",
  SS: "bg-teal-500/10 border-teal-500/30",
  SW: "bg-rose-500/10 border-rose-500/30",
};

interface ScrapeStatus {
  mode: "live" | "preflight" | "idle";
  active_state_ids: number[];
  next_event: { date: string | null; type: string | null; state_id: number | null } | null;
}

export default function NigeriaChoropleth() {
  const [pick, setPick] = useState(COMMON_PICKS[0]);
  // "election" colours states by winning party; "cbm" colours by CBM grassroots
  // strength (member density) from cbmnigeria.org — the same map, two lenses.
  const [source, setSource] = useState<"election" | "cbm" | "groups">("election");
  const [cbm, setCbm] = useState<CbmStateCoverage[] | null>(null);
  const [sg, setSg] = useState<SgActivity[] | null>(null);

  useEffect(() => {
    if (source !== "groups" || sg) return;
    let live = true;
    fetch(`${CBM_API}/api/support-dashboard/activity?level=state`)
      .then((r) => r.json())
      .then((d) => live && setSg(Array.isArray(d?.data) ? d.data : []))
      .catch(() => live && setSg([]));
    return () => {
      live = false;
    };
  }, [source, sg]);

  // Activity is a 3-level judgement, not a magnitude, so it maps to the metric
  // ramp by rank (attention/moderate/high) rather than to raw member counts.
  const sgMetric = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sg || []) {
      m.set(String(s.code).toUpperCase(), s.level === "high" ? 3 : s.level === "moderate" ? 2 : 1);
    }
    return m;
  }, [sg]);
  const sgGroups = useMemo(() => (sg || []).reduce((a, s) => a + (s.groups || 0), 0), [sg]);

  useEffect(() => {
    if (source !== "cbm" || cbm) return;
    let live = true;
    fetch(`${CBM_API}/api/coverage/national`)
      .then((r) => r.json())
      .then((d) => live && setCbm(Array.isArray(d?.data) ? d.data : []))
      .catch(() => live && setCbm([]));
    return () => {
      live = false;
    };
  }, [source, cbm]);

  // Map keys states by UPPER-cased HASC code (e.g. "LA"); coverage gives lower.
  const cbmMetric = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of cbm || []) m.set(String(s.code).toUpperCase(), s.members);
    return m;
  }, [cbm]);
  const cbmTotal = useMemo(() => (cbm || []).reduce((a, s) => a + s.members, 0), [cbm]);
  const cbmStatesWithData = useMemo(() => (cbm || []).filter((s) => s.members > 0).length, [cbm]);

  const { data: states } = useApiData<StateRow[]>("/api/states", 5 * 60_000);
  const { data: winners } = useApiData<WinnersResp>(
    `/api/analysis/winners?cycle=${pick.cycle}&type=${pick.type}`,
    pick.date >= "2026-06-01" ? 30_000 : 5 * 60_000, // poll live elections fast
  );
  // Drives the "LIVE" treatment so the landing points at the current election.
  const { data: scrape } = useApiData<ScrapeStatus>("/api/scrape/status", 30_000);

  const winnersCount = useMemo(
    () => (winners ? Object.keys(winners).length : 0),
    [winners],
  );

  // Map the daemon's active (live) numeric state_ids → state codes for the map.
  const liveStateCodes = useMemo(() => {
    if (!scrape || scrape.mode !== "live" || !states) return [] as string[];
    const byId = new Map(states.map((s) => [s.state_id, s.code] as const));
    return scrape.active_state_ids.map((id) => byId.get(id)).filter(Boolean) as string[];
  }, [scrape, states]);

  const liveStates = useMemo(
    () => liveStateCodes.map((c) => (states || []).find((s) => s.code === c)).filter(Boolean) as StateRow[],
    [liveStateCodes, states],
  );

  // code → { name, zone } so the map labels use authoritative DB names
  // ("FCT", "Akwa Ibom") instead of the raw GADM feature names.
  const statesByCode = useMemo(() => {
    const map: Record<string, { name: string; zone: string }> = {};
    for (const s of states || []) map[s.code] = { name: s.name, zone: s.zone };
    return map;
  }, [states]);

  return (
    <div className="space-y-3">
      {/* Source toggle: election results vs CBM grassroots coverage. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-dim">Source:</span>
        <div className="inline-flex rounded-full border border-dashboard-border bg-dashboard-card p-0.5">
          {([
            ["election", "Election results"],
            ["cbm", "CBM coverage"],
            ["groups", "Support groups"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSource(key)}
              className={`text-xs rounded-full px-3 py-1 transition-all ${
                source === key
                  ? "bg-accent-green/15 text-accent-green font-bold"
                  : "text-dim hover:text-primary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {source === "cbm" && cbm && (
          <span className="text-[11px] text-dim ml-auto">
            {cbmTotal.toLocaleString()} members · {cbmStatesWithData}/37 states
          </span>
        )}
        {source === "groups" && sg && (
          <span className="text-[11px] text-dim ml-auto">
            {sgGroups.toLocaleString()} support groups · activity last 30 days
          </span>
        )}
      </div>

      {source === "election" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-dim">Color by:</span>
          {COMMON_PICKS.map((p) => {
            const active = p.label === pick.label;
            return (
              <button
                key={p.label}
                onClick={() => setPick(p)}
                className={`text-xs rounded-full px-3 py-1 border transition-all ${
                  active
                    ? "border-accent-green bg-accent-green/10 text-accent-green font-bold"
                    : "border-dashboard-border bg-dashboard-card text-dim hover:text-primary"
                }`}
              >
                {p.label}
              </button>
            );
          })}
          {winners && (
            <span className="text-[11px] text-dim ml-auto">
              {winnersCount} state{winnersCount === 1 ? "" : "s"} with data
            </span>
          )}
        </div>
      )}

      {liveStates.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-accent-red/40 bg-accent-red/10 px-4 py-2.5">
          <span className="flex items-center gap-1.5 shrink-0">
            <span className="w-2 h-2 rounded-full bg-accent-red animate-pulse" />
            <span className="text-[11px] font-extrabold tracking-wider text-accent-red">LIVE</span>
          </span>
          <div className="text-[13px] min-w-0">
            <span className="font-extrabold text-accent-red">
              {liveStates.map((s) => s.name).join(", ")} · {pick.label.replace(/^\d{4}\s/, "")}
            </span>
            <span className="text-accent-red/70">
              {" "}— polls counting.{" "}
              {winnersCount === 0
                ? "Results are being entered as forms arrive."
                : `${winnersCount} state${winnersCount === 1 ? "" : "s"} reported.`}
            </span>
          </div>
          {liveStates.length === 1 && (
            <Link
              href={`/states/${liveStates[0].code}`}
              className="ml-auto shrink-0 text-xs font-bold text-accent-red underline hover:no-underline"
            >
              View {liveStates[0].name} results →
            </Link>
          )}
        </div>
      )}

      {source === "groups" ? (
        <LeafletMap
          mode="metric"
          metricByState={sgMetric}
          metricLabel="Activity (1 needs attention · 3 high)"
          statesByCode={statesByCode}
          title="Support group activity · last 30 days · click a state to expand"
        />
      ) : source === "cbm" ? (
        <LeafletMap
          mode="metric"
          metricByState={cbmMetric}
          metricLabel="CBM members"
          statesByCode={statesByCode}
          title="CBM grassroots coverage · members per state · click a state to expand"
        />
      ) : (
        <LeafletMap
          mode="winner"
          winnersByState={winners || {}}
          statesByCode={statesByCode}
          liveStateCodes={liveStateCodes}
          title={`${pick.label} · click a state to expand`}
        />
      )}

      <div className="rounded-lg border border-dashboard-border bg-dashboard-card p-3">
        <div className="text-[11px] uppercase tracking-wider text-dim mb-2">
          Direct nav · grouped by geopolitical zone
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1.5">
          {(states || []).map((s) => {
            const w = winners?.[s.code];
            return (
              <Link
                key={s.code}
                href={`/states/${s.code}`}
                className={`rounded px-2 py-1 text-xs font-semibold border ${
                  ZONE_COLORS[s.zone] || "bg-black/20 border-white/10"
                } hover:scale-[1.03] transition-transform`}
                title={
                  w
                    ? `${s.name}: ${w.winner_party_code} (${(w.winner_share * 100).toFixed(1)}%)`
                    : `${s.name}: no data`
                }
              >
                <div className="text-primary">{s.name}</div>
                <div className="text-[10px] flex items-center justify-between mt-0.5">
                  <span className="text-dim">{s.zone}</span>
                  {w && (
                    <span
                      className="font-mono"
                      style={{ color: w.winner_party_color || undefined }}
                    >
                      {w.winner_party_code}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
