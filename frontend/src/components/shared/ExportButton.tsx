"use client";

import { useExport } from "@/hooks/useExport";
import { ArrowDownTrayIcon } from "@heroicons/react/24/outline";

interface ExportButtonProps {
  endpoint: string;
  filename: string;
  label?: string;
}

export default function ExportButton({
  endpoint,
  filename,
  label = "Export",
}: ExportButtonProps) {
  const { download, loading } = useExport();

  return (
    <div className="flex gap-1.5">
      <button
        onClick={() => download(endpoint, `${filename}.csv`, "csv")}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dashboard-bg border border-dashboard-border text-[11px] font-semibold text-dim hover:text-primary hover:border-accent-green/50 disabled:opacity-40 transition-all"
      >
        <ArrowDownTrayIcon className="w-3.5 h-3.5" />
        {loading ? "..." : `${label} CSV`}
      </button>
      <button
        onClick={() => download(endpoint, `${filename}.xlsx`, "xlsx")}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dashboard-bg border border-dashboard-border text-[11px] font-semibold text-dim hover:text-primary hover:border-accent-green/50 disabled:opacity-40 transition-all"
      >
        <ArrowDownTrayIcon className="w-3.5 h-3.5" />
        {loading ? "..." : `${label} Excel`}
      </button>
    </div>
  );
}
