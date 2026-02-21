"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}

export default function StatCard({
  label,
  value,
  sub,
  color = "#e8eaf0",
}: StatCardProps) {
  const prevValue = useRef(value);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (prevValue.current !== value && prevValue.current !== "--") {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1500);
      prevValue.current = value;
      return () => clearTimeout(t);
    }
    prevValue.current = value;
  }, [value]);

  return (
    <div
      className={cn(
        "bg-dashboard-card border border-dashboard-border rounded-xl p-4 relative overflow-hidden group hover:border-white/10 hover:-translate-y-0.5 transition-all",
        flash && "data-flash"
      )}
    >
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-accent-green to-accent-blue opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="text-[11px] text-dim uppercase tracking-wider font-semibold mb-1.5">
        {label}
      </div>
      <div
        className="text-[26px] font-extrabold leading-none stat-value"
        style={{ color }}
      >
        {value}
      </div>
      {sub && (
        <div
          className="text-[11px] text-dim mt-1.5"
          dangerouslySetInnerHTML={{ __html: sub }}
        />
      )}
    </div>
  );
}
