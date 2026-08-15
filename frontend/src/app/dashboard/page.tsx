"use client";

/**
 * Dashboard home — national overview (previously at `/`).
 * Protected: requires login. Renders inside the DashboardShell.
 */

import Link from "next/link";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

import AnimatedCounter from "@/components/shared/AnimatedCounter";
import ElectionCountdown from "@/components/shared/ElectionCountdown";
import LiveElectionPanel from "@/components/shared/LiveElectionPanel";
import MethodologyDisclosure from "@/components/shared/MethodologyDisclosure";
import NewsFeed from "@/components/shared/NewsFeed";
import NigeriaChoropleth from "@/components/shared/NigeriaChoropleth";
import StatCard from "@/components/shared/StatCard";
import { useFilters } from "@/context/FilterContext";
import { useApiData } from "@/hooks/useApiData";
import type { CalendarEvent, StateRow } from "@/lib/api";
import { ELECTION_LABELS, type ElectionType } from "@/lib/electionTypeConfig";
import { formatNumber } from "@/lib/utils";

interface OverviewResponse {
  scope: string;
  cycle: number | null;
  totals: { states: number; lgas: number; elections: number; candidates?: number };
  cycles: { cycle: number; elections: number }[];
  election_types: { type: string; count: number }[];
  recent_elections: {
    election_id: number;
    cycle: number;
    type: string;
    state_id: number | null;
    date: string | null;
    status: string;
  }[];
}

export default function DashboardPage() {
  const { state, cycle } = useFilters();
  const qs = new URLSearchParams();
  if (state) qs.set("state", state);
  if (cycle) qs.set("cycle", String(cycle));
  const path = `/api/overview${qs.toString() ? `?${qs}` : ""}`;
  const { data: overview, error } = useApiData<OverviewResponse>(path, 60_000);
  const { data: states } = useApiData<StateRow[]>("/api/states", 5 * 60_000);
  const stateById = new Map((states || []).map((s) => [s.state_id, s] as const));

  // On polling day the news panel narrows to the state that is voting.
  const { data: nextEvent } = useApiData<CalendarEvent | null>(
    "/api/calendar/next",
    60_000,
  );
  const liveState =
    nextEvent?.status === "live" ? nextEvent.state_name ?? null : null;

  const cycleChartData = (overview?.cycles || [])
    .slice()
    .sort((a, b) => a.cycle - b.cycle)
    .map((c) => ({ name: String(c.cycle), elections: c.elections }));

  const typeChartData = (overview?.election_types || []).map((t) => ({
    name: ELECTION_LABELS[t.type as ElectionType] || t.type,
    count: t.count,
  }));

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-xl px-4 py-3 text-[13px] text-accent-red">
          Failed to load overview. Retrying…
        </div>
      )}

      <LiveElectionPanel />
      <ElectionCountdown />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="States covered"
          value={overview ? <AnimatedCounter value={overview.totals.states} /> : "—"}
          sub="of 36 + FCT"
          color="#3b82f6"
        />
        <StatCard
          label="Elections on record"
          value={overview ? <AnimatedCounter value={overview.totals.elections} /> : "—"}
          sub="across all cycles"
          color="#10b981"
        />
        <StatCard
          label="Candidates"
          value={overview ? <AnimatedCounter value={overview.totals.candidates ?? 0} /> : "—"}
          sub="with results attached"
          color="#a78bfa"
        />
        <StatCard
          label="Distinct cycles"
          value={overview ? <AnimatedCounter value={overview.cycles.length} /> : "—"}
          sub={
            overview && overview.cycles.length
              ? `${Math.min(...overview.cycles.map((c) => c.cycle))}–${Math.max(
                  ...overview.cycles.map((c) => c.cycle),
                )}`
              : "—"
          }
          color="#fbbf24"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="rounded-lg border border-dashboard-border bg-dashboard-card p-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-dim mb-2">
            Elections by cycle
          </h3>
          {cycleChartData.length === 0 ? (
            <div className="text-sm text-dim italic">No cycle data yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={cycleChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="name" stroke="#6b7280" fontSize={11} />
                <YAxis stroke="#6b7280" fontSize={11} />
                <Tooltip contentStyle={{ background: "#0c1226", border: "1px solid #1f2538" }} />
                <Bar dataKey="elections" fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>

        <section className="rounded-lg border border-dashboard-border bg-dashboard-card p-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-dim mb-2">
            By election type
          </h3>
          {typeChartData.length === 0 ? (
            <div className="text-sm text-dim italic">No type data yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={typeChartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis type="number" stroke="#6b7280" fontSize={11} />
                <YAxis type="category" dataKey="name" stroke="#6b7280" fontSize={10} width={140} />
                <Tooltip contentStyle={{ background: "#0c1226", border: "1px solid #1f2538" }} />
                <Bar dataKey="count" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <NewsFeed
          focus={liveState}
          limit={14}
          title={liveState ? "Live coverage" : "Political news"}
        />
        <div className="min-w-0">
          <NigeriaChoropleth />
        </div>
      </div>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wider text-dim mb-2">
          Recent elections
        </h2>
        {overview && overview.recent_elections.length === 0 && (
          <div className="text-sm text-dim italic">
            No elections ingested yet. The daemon is syncing now.
          </div>
        )}
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {(overview?.recent_elections || []).map((e) => {
            const s = e.state_id ? stateById.get(e.state_id) : null;
            return (
              <li
                key={e.election_id}
                className="rounded border border-dashboard-border bg-dashboard-card px-3 py-2 text-sm flex items-center justify-between"
              >
                <div>
                  <div className="font-semibold text-primary flex items-center gap-2">
                    {ELECTION_LABELS[e.type as ElectionType] || e.type} · {e.cycle}
                    {e.status === "live" && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-accent-red bg-accent-red/15 px-1.5 py-0.5 rounded">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-red animate-pulse" />
                        Live
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-dim">
                    {s ? s.name : e.state_id ? "—" : "National"} ·{" "}
                    {e.date || "date unknown"}
                    {e.status !== "live" && ` · ${e.status}`}
                  </div>
                </div>
                <Link
                  href={`/elections/${e.election_id}`}
                  className="text-xs text-accent-green underline"
                >
                  view →
                </Link>
              </li>
            );
          })}
        </ul>
        <MethodologyDisclosure />
      </section>
    </div>
  );
}
