interface SkeletonProps {
  width?: string;
  height?: string;
  className?: string;
}

export function SkeletonLine({
  width = "100%",
  height = "16px",
  className = "",
}: SkeletonProps) {
  return <div className={`skeleton ${className}`} style={{ width, height }} />;
}

export function SkeletonCard() {
  return (
    <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-4 space-y-3">
      <SkeletonLine width="60%" height="12px" />
      <SkeletonLine width="40%" height="28px" />
      <SkeletonLine width="80%" height="10px" />
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: cols }).map((_, j) => (
            <SkeletonLine
              key={j}
              width={`${100 / cols}%`}
              height="14px"
            />
          ))}
        </div>
      ))}
    </div>
  );
}
