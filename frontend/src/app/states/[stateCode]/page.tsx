"use client";

/**
 * Per-state landing. Shows: header, party-totals (when data exists),
 * election-type tiles, full elections table, LGA grid, candidates.
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";

import LiveElectionPanel from "@/components/shared/LiveElectionPanel";
import MethodologyDisclosure from "@/components/shared/MethodologyDisclosure";
import { RaceResultCard, type RaceResult } from "@/components/shared/RaceResultCard";
import { useApiData } from "@/hooks/useApiData";
import type { ElectionRow, StateRow } from "@/lib/api";

const StateDrillMap = dynamic(() => import("@/components/shared/StateDrillMap"), {
  ssr: false,
  loading: () => (
    <div className="rounded-lg border border-dashboard-border bg-dashboard-card p-8 text-center text-sm text-dim">
      Loading map…
    </div>
  ),
});

interface LgaRow {
  lga_id: number;
  name: string;
  kind: string;
  irev_lga_id: number | null;
}

interface CandidateRow {
  candidate_id: number;
  full_name: string;
  is_incumbent: boolean;
  party_code: string;
  party_color: string | null;
  election_id: number;
  election_type: string;
  election_type_label: string;
  cycle: number;
  lga_name: string | null;
  ward_name: string | null;
}

export default function StatePage() {
  const params = useParams<{ stateCode: string }>();
  const code = (params.stateCode || "").toUpperCase();
  // Derived, not seeded: `isLive` resolves after the elections API does, and
  // on polling day the results map has nothing to paint while the reporting
  // map does. An explicit choice by the reader always wins.
  const [sourceOverride, setSourceOverride] = useState<
    "election" | "reporting" | "cbm" | null
  >(null);

  const { data: state } = useApiData<StateRow>(`/api/states/${code}`, 60_000);
  const { data: elections } = useApiData<ElectionRow[]>(`/api/elections?state=${code}`, 60_000);
  const { data: lgas } = useApiData<LgaRow[]>(`/api/states/${code}/lgas`, 60_000);
  const { data: raceResults } = useApiData<{ elections: RaceResult[] }>(
    `/api/states/${code}/results-by-election`,
    5 * 60_000,
  );
  const { data: candidates } = useApiData<CandidateRow[]>(
    `/api/candidates?state=${code}&limit=200`,
    60_000,
  );

  const byType: Record<string, ElectionRow[]> = {};
  for (const e of elections || []) {
    (byType[e.election_type] ||= []).push(e);
  }
  const sortedTypes = Object.keys(byType).sort();

  // Most-recent election for the state drives the LGA/ward map colouring.
  const recentElection = useMemo(() => {
    const dated = (elections || [])
      .filter((e) => e.election_date)
      .slice()
      .sort((a, b) => (b.election_date as string).localeCompare(a.election_date as string));
    return dated[0] || (elections || [])[0] || null;
  }, [elections]);

  const isLive = useMemo(() => {
    if (!recentElection?.election_date) return false;
    const t = Date.parse(recentElection.election_date);
    const now = Date.now();
    // election day or the ~2 days after (results still uploading)
    return now - t < 2.5 * 86_400_000 && t - now < 86_400_000;
  }, [recentElection]);

  const source = sourceOverride ?? (isLive ? "reporting" : "election");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold text-primary">{state?.name || code}</h1>
        <p className="text-sm text-dim">
          {state?.zone ? `${state.zone} geopolitical zone · ` : ""}
          {elections?.length ?? 0} elections · {lgas?.length ?? 0} LGAs · {candidates?.length ?? 0} candidates
        </p>
      </header>

      {/* Today's race leads. Without this the page opened on the cumulative
          party-share block, which on polling day reads as a live result when
          it is actually historical. */}
      <LiveElectionPanel stateCode={code} />

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-dim">
            {state?.name || code} map · LGAs &amp; wards
            {source === "election" && recentElection && (
              <span className="font-normal text-dim">
                {" "}— {recentElection.election_type_label} {recentElection.cycle}
              </span>
            )}
            {source === "reporting" && (
              <span className="font-normal text-dim"> — result sheets published</span>
            )}
            {source === "cbm" && <span className="font-normal text-dim"> — CBM member density</span>}
          </h2>
          <div className="inline-flex rounded-full border border-dashboard-border bg-dashboard-card p-0.5">
            {([
              ["election", "Results"],
              ["reporting", "Reporting"],
              ["cbm", "CBM coverage"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSourceOverride(key)}
                className={`text-xs rounded-full px-3 py-1 transition-all ${
                  source === key ? "bg-accent-green/15 text-accent-green font-bold" : "text-dim hover:text-primary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <StateDrillMap
          stateCode={code}
          stateName={state?.name || code}
          electionId={recentElection?.election_id ?? null}
          live={isLive}
          source={source}
        />
      </section>

      {raceResults && raceResults.elections.length > 0 && (
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wider text-dim mb-1">
            Past results · {state?.name || code}
          </h2>
          <p className="text-[11px] text-dim mb-3">
            Each concluded race on its own — winner, runner-up, and the gap
            between them.
            {isLive && " Today's election is not included — see the live panel above."}
          </p>
          <div className="space-y-2">
            {raceResults.elections.map((r) => (
              <RaceResultCard key={r.election_id} race={r} />
            ))}
          </div>
        </section>
      )}

      {sortedTypes.length > 0 && (
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wider text-dim mb-2">
            Election types
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {sortedTypes.map((t) => (
              <div
                key={t}
                className="rounded-lg border border-dashboard-border bg-dashboard-card p-3"
              >
                <div className="text-[10px] uppercase tracking-wider text-dim">
                  {byType[t][0].election_type_label}
                </div>
                <div className="text-2xl font-extrabold text-primary mt-1">
                  {byType[t].length}
                </div>
                <div className="text-[10px] text-dim mt-1">
                  {byType[t].map((e) => e.cycle).sort().reverse().slice(0, 3).join(", ")}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wider text-dim mb-2">
          Elections
        </h2>
        {(!elections || elections.length === 0) && (
          <div className="text-sm text-dim italic border border-dashboard-border rounded p-4">
            No elections for {state?.name || code} ingested yet.
          </div>
        )}
        <div className="overflow-x-auto rounded border border-dashboard-border">
          <table className="w-full text-sm">
            <thead className="bg-black/20 text-[11px] uppercase tracking-wider text-dim">
              <tr>
                <th className="text-left py-2 px-3">Cycle</th>
                <th className="text-left py-2 px-3">Type</th>
                <th className="text-left py-2 px-3">Date</th>
                <th className="text-right py-2 px-3"></th>
              </tr>
            </thead>
            <tbody>
              {(elections || []).map((e) => (
                <tr key={e.election_id} className="border-t border-dashboard-border/40">
                  <td className="py-2 px-3 font-semibold">{e.cycle}</td>
                  <td className="py-2 px-3">
                    {e.election_type_label}
                    {e.status === "live" && (
                      <span className="ml-2 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-accent-red bg-accent-red/15 px-1.5 py-0.5 rounded align-middle">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-red animate-pulse" />
                        Live
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-dim font-mono text-xs">{e.election_date || "—"}</td>
                  <td className="py-2 px-3 text-right">
                    <Link href={`/elections/${e.election_id}`} className="text-xs text-accent-green underline">
                      view →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {candidates && candidates.length > 0 && (
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wider text-dim mb-2">
            Candidates <span className="font-normal text-dim">({candidates.length})</span>
          </h2>
          <div className="overflow-x-auto rounded border border-dashboard-border">
            <table className="w-full text-sm">
              <thead className="bg-black/20 text-[11px] uppercase tracking-wider text-dim">
                <tr>
                  <th className="text-left py-2 px-3">Candidate</th>
                  <th className="text-left py-2 px-3">Party</th>
                  <th className="text-left py-2 px-3">Race</th>
                  <th className="text-left py-2 px-3">Scope</th>
                </tr>
              </thead>
              <tbody>
                {candidates.slice(0, 50).map((c) => (
                  <tr key={c.candidate_id} className="border-t border-dashboard-border/40">
                    <td className="py-2 px-3 font-semibold">
                      {c.full_name}
                      {c.is_incumbent && <span className="ml-1 text-[10px] text-accent-orange">(i)</span>}
                    </td>
                    <td className="py-2 px-3">
                      <span
                        className="inline-block w-2 h-2 rounded-full mr-1 align-middle"
                        style={{ background: c.party_color || "#94a3b8" }}
                      />
                      {c.party_code}
                    </td>
                    <td className="py-2 px-3 text-xs">{c.election_type_label} · {c.cycle}</td>
                    <td className="py-2 px-3 text-xs text-dim">
                      {c.ward_name ? `${c.lga_name} → ${c.ward_name}` : c.lga_name || "state"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wider text-dim mb-2">
          LGAs <span className="text-dim font-normal">({lgas?.length ?? 0})</span>
        </h2>
        {(!lgas || lgas.length === 0) && (
          <div className="text-sm text-dim italic">
            LGA structure not synced yet — the daemon will pick this state up shortly.
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {(lgas || []).map((l) => (
            <div
              key={l.lga_id}
              className="rounded border border-dashboard-border bg-dashboard-card px-2 py-1.5 text-xs"
            >
              <div className="font-semibold text-primary">{l.name}</div>
              <div className="text-[10px] text-dim">{l.kind}</div>
            </div>
          ))}
        </div>
      </section>

      <MethodologyDisclosure />
    </div>
  );
}
