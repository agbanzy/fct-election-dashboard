import { formatNumber } from "@/lib/utils";

interface ProgressBarProps {
  label: string;
  pct: number;
  uploaded: number;
  total: number;
  variant: "chairman" | "councillor";
}

export default function ProgressBar({ label, pct, uploaded, total, variant }: ProgressBarProps) {
  const gradient =
    variant === "chairman"
      ? "from-[#004d25] to-accent-green"
      : "from-[#1e3a5f] to-accent-blue";
  const textColor = variant === "chairman" ? "text-accent-green" : "text-accent-blue";

  return (
    <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-sm font-bold">{label}</h3>
        <span className={`${textColor} font-extrabold text-lg`}>{pct}%</span>
      </div>
      <div className="bg-[#1a1f2e] rounded-[10px] h-7 overflow-hidden">
        <div
          className={`h-full rounded-[10px] bg-gradient-to-r ${gradient} flex items-center justify-center text-[11px] font-extrabold text-white min-w-[45px] transition-[width] duration-1000 ease-out`}
          style={{ width: `${Math.max(pct, 1.5)}%` }}
        >
          {pct > 5 ? `${pct}%` : ""}
        </div>
      </div>
      <div className="flex justify-between mt-1.5 text-[11px] text-dim">
        <span>{formatNumber(uploaded)} uploaded</span>
        <span>{formatNumber(total)} total PUs</span>
      </div>
    </div>
  );
}
