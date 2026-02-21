export function pctColor(p: number): string {
  if (p >= 75) return "#10b981";
  if (p >= 50) return "#3b82f6";
  if (p >= 25) return "#f59e0b";
  return "#ef4444";
}

export function pctColorClass(p: number): string {
  if (p >= 75) return "text-accent-green";
  if (p >= 50) return "text-accent-blue";
  if (p >= 25) return "text-accent-orange";
  return "text-accent-red";
}

export function pctBgClass(p: number): string {
  if (p >= 75) return "bg-accent-green";
  if (p >= 50) return "bg-accent-blue";
  if (p >= 25) return "bg-accent-orange";
  return "bg-accent-red";
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}
