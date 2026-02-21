import { pctColor } from "@/lib/utils";

interface MiniProgressProps {
  pct: number;
  height?: number;
  width?: string;
}

export default function MiniProgress({ pct, height = 6, width = "100%" }: MiniProgressProps) {
  return (
    <div
      className="bg-[#1a1f2e] rounded-full overflow-hidden"
      style={{ height, width }}
    >
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out"
        style={{
          width: `${Math.max(pct, 1)}%`,
          backgroundColor: pctColor(pct),
        }}
      />
    </div>
  );
}
