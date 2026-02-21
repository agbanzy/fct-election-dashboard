"use client";

import { useState, useRef, useEffect } from "react";
import { useApiData } from "@/hooks/useApiData";
import ExportButton from "@/components/shared/ExportButton";
import MiniProgress from "@/components/shared/MiniProgress";
import Badge from "@/components/shared/Badge";
import { SkeletonCard, SkeletonTable } from "@/components/shared/SkeletonLoader";
import {
  OverviewResponse,
  Candidate,
  RecentResult,
} from "@/lib/types";
import { formatNumber, pctColor, formatTime } from "@/lib/utils";
import { getPartyColor } from "@/lib/constants";

export default function ElectionsPage() {
  const { data: overview, error: overviewErr, isLoading: overviewLoading } =
    useApiData<OverviewResponse>("/api/overview");
  const { data: candidates, error: candidatesErr, isLoading: candidatesLoading } =
    useApiData<Candidate[]>("/api/candidates");
  const { data: recentResults, error: recentErr } =
    useApiData<RecentResult[]>("/api/recent-results");
  const [activeCouncil, setActiveCouncil] = useState("AMAC");

  const feedRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  const elections = overview?.elections || [];
  const councils = [...new Set((candidates || []).map((c) => c.area_council))].sort();
  const filteredCandidates = (candidates || []).filter(
    (c) => c.area_council === activeCouncil
  );

  // Auto-scroll recent results feed to top on new data
  useEffect(() => {
    const currentCount = (recentResults || []).length;
    if (currentCount > prevCountRef.current && feedRef.current) {
      feedRef.current.scrollTop = 0;
    }
    prevCountRef.current = currentCount;
  }, [recentResults]);

  const hasError = overviewErr || candidatesErr || recentErr;

  return (
    <div className="space-y-5">
      {/* Error Banner */}
      {hasError && (
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-xl px-4 py-3 text-[13px] text-accent-red font-semibold">
          Failed to load some data. Retrying automatically...
        </div>
      )}

      {/* Election Breakdown Table */}
      <div className="flex items-center justify-between">
        <SectionTitle>Election Breakdown</SectionTitle>
        <ExportButton endpoint="/api/export/elections" filename="elections" />
      </div>
      <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-4 overflow-x-auto">
        {overviewLoading && !overview ? (
          <SkeletonTable rows={6} cols={5} />
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {["Election", "Type", "Total PUs", "Results", "Progress"].map((h) => (
                  <th key={h} className="text-left px-3 py-2.5 text-dim font-bold text-[10px] uppercase tracking-wider border-b-2 border-dashboard-border">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {elections.map((e) => {
                const pct = e.pct || 0;
                return (
                  <tr key={e.id} className="hover:bg-dashboard-card-hover">
                    <td className="px-3 py-2.5 border-b border-dashboard-border font-semibold">
                      {e.domain_name || e.full_name}
                    </td>
                    <td className="px-3 py-2.5 border-b border-dashboard-border">
                      <Badge variant={e.election_type === "CHAIRMAN" ? "green" : "blue"}>
                        {e.election_type}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 border-b border-dashboard-border">
                      {formatNumber(e.total_pus || 0)}
                    </td>
                    <td className="px-3 py-2.5 border-b border-dashboard-border">
                      {formatNumber(e.total_results || 0)}
                    </td>
                    <td className="px-3 py-2.5 border-b border-dashboard-border">
                      <div className="flex items-center gap-2">
                        <MiniProgress pct={pct} width="80px" />
                        <span className="text-[12px] font-bold tabular-nums" style={{ color: pctColor(pct) }}>
                          {pct}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {elections.length === 0 && !overviewLoading && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-dim">No election data yet...</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Candidates + Recent Results */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Candidates */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <SectionTitle>Chairmanship Candidates</SectionTitle>
            <ExportButton
              endpoint="/api/export/candidates"
              filename="candidates"
            />
          </div>

          {/* Tabs */}
          {councils.length > 0 && (
            <div className="flex gap-0.5 mb-3 bg-dashboard-bg rounded-lg p-1 flex-wrap">
              {councils.map((c) => (
                <button
                  key={c}
                  onClick={() => setActiveCouncil(c)}
                  aria-label={`Show ${c} candidates`}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-bold transition-all ${
                    c === activeCouncil
                      ? "bg-dashboard-card text-primary shadow"
                      : "text-dim hover:text-primary"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-4 max-h-[500px] overflow-y-auto">
            {candidatesLoading && !candidates ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            ) : filteredCandidates.length > 0 ? (
              filteredCandidates.map((c, i) => {
                const partyColor = getPartyColor(c.party_abbrev);
                const badge = c.status?.includes("WITHDRAWN") ? (
                  <Badge variant="red">WITHDRAWN</Badge>
                ) : c.status?.includes("Incumbent") ? (
                  <Badge variant="green">INCUMBENT</Badge>
                ) : (
                  <Badge variant="blue">CHALLENGER</Badge>
                );

                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 py-2.5 border-b border-dashboard-border last:border-b-0"
                  >
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-extrabold text-white flex-shrink-0"
                      style={{ backgroundColor: partyColor }}
                    >
                      {(c.party_abbrev || "?").substring(0, 3)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold truncate">
                        {c.candidate_name}
                      </div>
                      <div className="text-[11px] text-dim truncate">
                        {c.party_full} ({c.party_abbrev})
                      </div>
                    </div>
                    {badge}
                  </div>
                );
              })
            ) : (
              <p className="text-dim text-sm py-4 text-center">
                {candidates && candidates.length > 0
                  ? `No candidates for ${activeCouncil}`
                  : "No candidate data yet..."}
              </p>
            )}
          </div>
        </div>

        {/* Recent Results Feed */}
        <div>
          <SectionTitle>Recent Result Uploads</SectionTitle>
          <div
            ref={feedRef}
            className="bg-dashboard-card border border-dashboard-border rounded-xl p-4 max-h-[600px] overflow-y-auto mt-3"
          >
            {(recentResults || []).length > 0 ? (
              recentResults!.map((r, i) => (
                <div
                  key={i}
                  className="py-2.5 border-b border-dashboard-border last:border-b-0"
                >
                  <div className="text-[13px] font-medium">
                    {r.pu_name || r.pu_code}
                  </div>
                  <div className="text-[11px] text-dim mt-0.5">
                    {r.lga_name} &rarr; {r.ward_name} &bull; {r.pu_code}
                    {r.result_uploaded_at && (
                      <> &bull; {formatTime(r.result_uploaded_at)}</>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-dim text-sm py-4 text-center">
                No results uploaded yet...
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-base font-extrabold flex items-center gap-2.5 tracking-tight section-title">
      {children}
      <span className="flex-1 h-px bg-dashboard-border" />
    </h2>
  );
}
