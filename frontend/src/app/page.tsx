"use client";

import { useApiData } from "@/hooks/useApiData";
import StatCard from "@/components/shared/StatCard";
import ProgressBar from "@/components/shared/ProgressBar";
import MiniProgress from "@/components/shared/MiniProgress";
import { SkeletonCard, SkeletonTable } from "@/components/shared/SkeletonLoader";
import {
  OverviewResponse,
  LGABreakdownResponse,
  CouncillorshipElection,
} from "@/lib/types";
import { formatNumber, pctColor } from "@/lib/utils";
import Link from "next/link";

export default function OverviewPage() {
  const { data: overview, error: overviewErr, isLoading: overviewLoading } =
    useApiData<OverviewResponse>("/api/overview");
  const { data: lgaData, error: lgaErr } =
    useApiData<LGABreakdownResponse>("/api/lga-breakdown");
  const { data: councillorship } =
    useApiData<CouncillorshipElection[]>("/api/councillorship");

  const chair = overview?.stats?.CHAIRMAN || {
    total_pus: 0,
    results_uploaded: 0,
    percentage: 0,
  };
  const council = overview?.stats?.COUNCILLOR || {
    total_pus: 0,
    results_uploaded: 0,
    percentage: 0,
  };
  const totalPU = chair.total_pus + council.total_pus;
  const totalRes = chair.results_uploaded + council.results_uploaded;
  const totalPct =
    totalPU > 0 ? ((totalRes / totalPU) * 100).toFixed(1) : "0";

  let totalVoters = 0;
  (overview?.area_councils || []).forEach((c) => {
    const v = parseInt(c.registered_voters);
    if (!isNaN(v)) totalVoters += v;
  });

  return (
    <div className="space-y-5">
      {/* Error Banner */}
      {(overviewErr || lgaErr) && (
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-xl px-4 py-3 text-[13px] text-accent-red font-semibold">
          Failed to load data. Retrying automatically...
        </div>
      )}

      {/* Stat Cards */}
      {overviewLoading && !overview ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <StatCard
            label="Total Polling Units"
            value={totalPU ? formatNumber(totalPU) : "--"}
            sub="6 Area Councils"
            color="#3b82f6"
          />
          <StatCard
            label="Results Uploaded"
            value={totalRes ? formatNumber(totalRes) : "--"}
            sub={`${totalPct}% complete`}
            color="#10b981"
          />
          <StatCard
            label="Pending"
            value={totalPU ? formatNumber(totalPU - totalRes) : "--"}
            sub="Awaiting upload"
            color="#f59e0b"
          />
          <StatCard
            label="Area Councils"
            value="6"
            sub="62 Wards &bull; 68 Positions"
            color="#a78bfa"
          />
          <StatCard
            label="Registered Voters"
            value={
              totalVoters > 0
                ? `${(totalVoters / 1e6).toFixed(2)}M`
                : "1.68M"
            }
            sub="FCT Total"
            color="#fbbf24"
          />
          <StatCard
            label="Scrapes"
            value={overview?.scraper?.scrape_count ?? 0}
            sub={
              overview?.scraper?.last_scrape
                ? `Last: ${new Date(overview.scraper.last_scrape).toLocaleTimeString()}`
                : "Waiting..."
            }
            color="#06b6d4"
          />
        </div>
      )}

      {/* Progress Bars */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ProgressBar
          label="Chairmanship Results"
          pct={chair.percentage}
          uploaded={chair.results_uploaded}
          total={chair.total_pus}
          variant="chairman"
        />
        <ProgressBar
          label="Councillorship Results"
          pct={council.percentage}
          uploaded={council.results_uploaded}
          total={council.total_pus}
          variant="councillor"
        />
      </div>

      {/* LGA Cards */}
      <SectionTitle>Chairmanship Results by Area Council</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {(lgaData?.lga_data || []).length > 0
          ? lgaData!.lga_data.map((lga) => {
              const c = lga.elections?.CHAIRMAN || {
                total_pus: 0,
                results_uploaded: 0,
                percentage: 0,
              };
              const pct = c.percentage || 0;
              return (
                <Link
                  key={lga.lga_name}
                  href={`/elections/${encodeURIComponent(lga.lga_name)}`}
                  className="bg-dashboard-card border border-dashboard-border rounded-xl p-4 hover:border-nigeria-green hover:-translate-y-0.5 hover:shadow-lg hover:shadow-nigeria-green/10 transition-all group"
                >
                  <h4 className="text-[15px] font-bold mb-2.5 group-hover:text-accent-green transition-colors">
                    {lga.lga_name}
                  </h4>
                  <div className="flex justify-between text-[12px] text-dim mb-1">
                    <span>Results Uploaded</span>
                    <span className="text-primary font-semibold">
                      {c.results_uploaded} / {c.total_pus}
                    </span>
                  </div>
                  <div className="flex justify-between text-[12px] text-dim mb-3">
                    <span>Pending</span>
                    <span className="text-primary font-semibold">
                      {c.total_pus - c.results_uploaded}
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-dim">Progress</span>
                    <span
                      className="font-extrabold"
                      style={{ color: pctColor(pct) }}
                    >
                      {pct}%
                    </span>
                  </div>
                  <MiniProgress pct={pct} height={8} />
                </Link>
              );
            })
          : !lgaErr && (
              <div className="col-span-full text-center text-dim py-8">
                Waiting for first data scrape...
              </div>
            )}
      </div>

      {/* Elections Table */}
      <SectionTitle>Detailed Election Breakdown</SectionTitle>
      <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-4 overflow-x-auto">
        {overviewLoading && !overview ? (
          <SkeletonTable rows={6} cols={6} />
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {[
                  "Election",
                  "Type",
                  "Total PUs",
                  "Results",
                  "Progress",
                  "%",
                ].map((h) => (
                  <th
                    key={h}
                    className="text-left px-3 py-2.5 text-dim font-bold text-[10px] uppercase tracking-wider border-b-2 border-dashboard-border"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(overview?.elections || []).map((e) => {
                const pct = e.pct || 0;
                return (
                  <tr key={e.id} className="hover:bg-dashboard-card-hover">
                    <td className="px-3 py-2.5 border-b border-dashboard-border font-semibold">
                      {e.domain_name || e.full_name}
                    </td>
                    <td className="px-3 py-2.5 border-b border-dashboard-border">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          e.election_type === "CHAIRMAN"
                            ? "bg-accent-green/12 text-accent-green"
                            : "bg-accent-blue/12 text-accent-blue"
                        }`}
                      >
                        {e.election_type}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 border-b border-dashboard-border">
                      {formatNumber(e.total_pus || 0)}
                    </td>
                    <td className="px-3 py-2.5 border-b border-dashboard-border">
                      {formatNumber(e.total_results || 0)}
                    </td>
                    <td className="px-3 py-2.5 border-b border-dashboard-border">
                      <MiniProgress pct={pct} width="80px" />
                    </td>
                    <td
                      className="px-3 py-2.5 border-b border-dashboard-border font-bold tabular-nums"
                      style={{ color: pctColor(pct) }}
                    >
                      {pct}%
                    </td>
                  </tr>
                );
              })}
              {(overview?.elections || []).length === 0 && !overviewLoading && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-8 text-center text-dim"
                  >
                    No election data yet...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Councillorship Grid */}
      <SectionTitle>Councillorship Results by Ward</SectionTitle>
      <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
          {(councillorship || []).length > 0
            ? councillorship!.map((w) => {
                const pct = w.pct || 0;
                return (
                  <div
                    key={w.id}
                    className="bg-dashboard-bg border border-dashboard-border rounded-lg p-2.5"
                  >
                    <div className="text-[12px] font-semibold mb-1 truncate">
                      {w.ward_name}
                    </div>
                    <div className="flex justify-between text-[11px] text-dim">
                      <span>
                        {w.total_results || 0}/{w.total_pus || 0}
                      </span>
                      <span
                        className="font-bold"
                        style={{ color: pctColor(pct) }}
                      >
                        {pct}%
                      </span>
                    </div>
                    <MiniProgress pct={pct} height={4} />
                  </div>
                );
              })
            : (
              <div className="col-span-full text-center text-dim py-5">
                Waiting for data...
              </div>
            )}
        </div>
      </div>

      {/* Area Councils Reference */}
      <SectionTitle>Area Council Reference Data</SectionTitle>
      <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-4 overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              {[
                "Area Council",
                "Wards",
                "Polling Units",
                "Reg. Voters",
                "Chair Candidates",
                "Council Positions",
              ].map((h) => (
                <th
                  key={h}
                  className="text-left px-3 py-2.5 text-dim font-bold text-[10px] uppercase tracking-wider border-b-2 border-dashboard-border"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(overview?.area_councils || []).map((c) => (
              <tr key={c.name} className="hover:bg-dashboard-card-hover">
                <td className="px-3 py-2.5 border-b border-dashboard-border font-semibold">
                  {c.name}
                </td>
                <td className="px-3 py-2.5 border-b border-dashboard-border">
                  {c.total_wards}
                </td>
                <td className="px-3 py-2.5 border-b border-dashboard-border">
                  {formatNumber(c.polling_units || 0)}
                </td>
                <td className="px-3 py-2.5 border-b border-dashboard-border">
                  {c.registered_voters}
                </td>
                <td className="px-3 py-2.5 border-b border-dashboard-border">
                  {c.chairmanship_candidates}
                </td>
                <td className="px-3 py-2.5 border-b border-dashboard-border">
                  {c.councillorship_positions}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-base font-extrabold flex items-center gap-2.5 tracking-tight mt-2 section-title">
      {children}
      <span className="flex-1 h-px bg-dashboard-border" />
    </h2>
  );
}
