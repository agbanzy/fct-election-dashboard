import { cn } from "@/lib/utils";

const VARIANTS = {
  green: "bg-accent-green/12 text-accent-green",
  blue: "bg-accent-blue/12 text-accent-blue",
  orange: "bg-accent-orange/12 text-accent-orange",
  red: "bg-accent-red/12 text-accent-red",
  purple: "bg-accent-purple/12 text-accent-purple",
};

interface BadgeProps {
  children: React.ReactNode;
  variant?: keyof typeof VARIANTS;
}

export default function Badge({ children, variant = "blue" }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-block px-2 py-0.5 rounded text-[10px] font-bold tracking-wide",
        VARIANTS[variant]
      )}
    >
      {children}
    </span>
  );
}
