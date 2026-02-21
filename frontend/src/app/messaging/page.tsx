"use client";

import { useApiData } from "@/hooks/useApiData";
import StatCard from "@/components/shared/StatCard";
import { SkeletonCard } from "@/components/shared/SkeletonLoader";
import { MessagingStats } from "@/lib/types";

export default function MessagingPage() {
  const { data: stats, error: statsErr, isLoading: statsLoading } =
    useApiData<MessagingStats>("/api/messaging/stats");

  const sent = stats?.sent ?? 0;
  const failed = stats?.failed ?? 0;
  const total = stats?.total_agents ?? 0;
  const pending = stats?.pending ?? 0;
  const successRate = total > 0 ? ((sent / total) * 100).toFixed(1) : "0";

  return (
    <div className="space-y-5">
      {/* Error Banner */}
      {statsErr && (
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-xl px-4 py-3 text-[13px] text-accent-red font-semibold">
          Failed to load messaging data. Retrying automatically...
        </div>
      )}

      <SectionTitle>WhatsApp Messaging Dashboard</SectionTitle>

      {/* Stats Cards */}
      {statsLoading && !stats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="Messages Sent"
            value={sent}
            sub={`${successRate}% delivery rate`}
            color="#10b981"
          />
          <StatCard
            label="Failed"
            value={failed}
            sub="Delivery failures"
            color="#ef4444"
          />
          <StatCard
            label="Pending"
            value={pending}
            sub="Not yet contacted"
            color="#f59e0b"
          />
          <StatCard
            label="Total Agents"
            value={total}
            sub="Registered polling agents"
            color="#3b82f6"
          />
        </div>
      )}

      {/* Delivery Progress */}
      <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-5">
        <h3 className="text-sm font-bold mb-4">Delivery Progress</h3>
        <div className="space-y-4">
          {/* Sent bar */}
          <div>
            <div className="flex justify-between text-[12px] mb-1.5">
              <span className="text-dim font-semibold">Sent</span>
              <span className="text-accent-green font-bold">
                {sent} / {total}
              </span>
            </div>
            <div className="bg-[#1a1f2e] rounded-full h-5 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#004d25] to-accent-green transition-[width] duration-700 flex items-center justify-center text-[10px] font-bold text-white"
                style={{
                  width: `${total > 0 ? Math.max((sent / total) * 100, 2) : 0}%`,
                }}
              >
                {total > 0 ? `${((sent / total) * 100).toFixed(0)}%` : ""}
              </div>
            </div>
          </div>

          {/* Failed bar */}
          <div>
            <div className="flex justify-between text-[12px] mb-1.5">
              <span className="text-dim font-semibold">Failed</span>
              <span className="text-accent-red font-bold">
                {failed} / {total}
              </span>
            </div>
            <div className="bg-[#1a1f2e] rounded-full h-5 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#5f1a1a] to-accent-red transition-[width] duration-700 flex items-center justify-center text-[10px] font-bold text-white"
                style={{
                  width: `${total > 0 ? Math.max((failed / total) * 100, 0) : 0}%`,
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Sent Numbers List */}
      {stats?.sent_numbers && stats.sent_numbers.length > 0 && (
        <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold">
              Delivered Messages ({stats.sent_numbers.length})
            </h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 max-h-[400px] overflow-y-auto">
            {stats.sent_numbers.map((num, i) => (
              <div
                key={i}
                className="bg-dashboard-bg border border-dashboard-border rounded-lg px-3 py-2 text-[12px] font-mono flex items-center gap-2"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-accent-green flex-shrink-0" />
                {num}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Failed Numbers */}
      {stats?.failed_numbers && stats.failed_numbers.length > 0 && (
        <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-5">
          <h3 className="text-sm font-bold mb-4 text-accent-red">
            Failed Deliveries ({stats.failed_numbers.length})
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {stats.failed_numbers.map((num, i) => (
              <div
                key={i}
                className="bg-dashboard-bg border border-dashboard-border rounded-lg px-3 py-2 text-[12px] font-mono flex items-center gap-2"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-accent-red flex-shrink-0" />
                {num}
              </div>
            ))}
          </div>
        </div>
      )}
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
