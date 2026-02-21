"use client";

import { useApiData } from "@/hooks/useApiData";
import { Ward } from "@/lib/types";
import MiniProgress from "@/components/shared/MiniProgress";
import Badge from "@/components/shared/Badge";
import { SkeletonTable } from "@/components/shared/SkeletonLoader";
import { pctColor } from "@/lib/utils";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { use } from "react";

export default function LGADetailPage({
  params,
}: {
  params: Promise<{ lgaName: string }>;
}) {
  const { lgaName } = use(params);
  const decoded = decodeURIComponent(lgaName);
  const { data: wards, error: wardsErr, isLoading: wardsLoading } = useApiData<Ward[]>(
    `/api/ward-breakdown/${encodeURIComponent(decoded)}`
  );

  return (
    <div className="space-y-5">
      {wardsErr && (
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-xl px-4 py-3 text-[13px] text-accent-red font-semibold">
          Failed to load ward data. Retrying automatically...
        </div>
      )}

      <div className="flex items-center gap-3">
        <Link
          href="/elections"
          aria-label="Back to elections"
          className="p-2 rounded-lg bg-dashboard-card border border-dashboard-border hover:border-accent-green/50 transition-colors"
        >
          <ArrowLeftIcon className="w-4 h-4" />
        </Link>
        <h1 className="text-lg font-extrabold">
          {decoded} &mdash; Ward Breakdown
        </h1>
      </div>

      <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-4 overflow-x-auto">
        {wardsLoading && !wards ? (
          <SkeletonTable rows={8} cols={5} />
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {["Ward", "Type", "PUs", "Results", "Progress"].map((h) => (
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
              {(wards || []).length > 0 ? (
                wards!.map((w, i) => {
                  const pct =
                    w.total_pus > 0
                      ? parseFloat(
                          ((w.results_uploaded / w.total_pus) * 100).toFixed(1)
                        )
                      : 0;
                  return (
                    <tr key={i} className="hover:bg-dashboard-card-hover">
                      <td className="px-3 py-2.5 border-b border-dashboard-border font-semibold">
                        {w.ward_name}
                      </td>
                      <td className="px-3 py-2.5 border-b border-dashboard-border">
                        <Badge variant="blue">{w.election_type}</Badge>
                      </td>
                      <td className="px-3 py-2.5 border-b border-dashboard-border">
                        {w.total_pus}
                      </td>
                      <td className="px-3 py-2.5 border-b border-dashboard-border">
                        {w.results_uploaded}
                      </td>
                      <td className="px-3 py-2.5 border-b border-dashboard-border">
                        <div className="flex items-center gap-2">
                          <MiniProgress pct={pct} width="80px" />
                          <span
                            className="text-[12px] font-bold"
                            style={{ color: pctColor(pct) }}
                          >
                            {pct}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-dim">
                    {wardsLoading ? "Loading..." : "No ward data yet"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
