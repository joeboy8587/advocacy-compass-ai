import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function Stat({
  label,
  value,
  icon: Icon,
  tone = "green",
  hint,
}: {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  tone?: "green" | "orange" | "cyan" | "magenta";
  hint?: string;
}) {
  const toneClass =
    tone === "orange"
      ? "neon-text-orange"
      : tone === "cyan"
        ? "text-[color:var(--neon-cyan)]"
        : tone === "magenta"
          ? "text-[color:var(--neon-magenta)]"
          : "neon-text-green";
  return (
    <div className="panel scanline p-4 relative">
      <div className="flex items-start justify-between">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {label}
        </div>
        {Icon && <Icon className={`size-4 ${toneClass}`} />}
      </div>
      <div className={`mt-3 text-3xl font-bold tabular-nums ${toneClass}`}>{value}</div>
      {hint && (
        <div className="mt-1 text-[10px] text-muted-foreground uppercase tracking-wider">
          {hint}
        </div>
      )}
    </div>
  );
}

export function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString();
}
