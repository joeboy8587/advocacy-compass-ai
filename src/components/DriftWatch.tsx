import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { TrendingUp, Loader2 } from "lucide-react";
import { getDriftWatch } from "@/lib/profiler.functions";
import { BehaviorProfile } from "@/components/BehaviorProfile";

export function DriftWatch() {
  const q = useQuery({
    queryKey: ["drift-watch"],
    queryFn: () => getDriftWatch({ data: { limit: 10 } }),
    refetchInterval: 300_000,
  });
  const [icao, setIcao] = useState<string | null>(null);

  return (
    <section className="panel scanline p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-widest neon-text-orange flex items-center gap-2">
          <TrendingUp className="size-4" /> Drift Watch · behaviour changed recently
        </div>
        <Link to="/clusters" className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-accent">
          All clusters →
        </Link>
      </div>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
        These aircraft are flying differently than they were at the last model run — a change of habit, not a violation.
      </p>
      {q.isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      {q.isError && <div className="text-xs text-destructive">Drift watch unavailable.</div>}
      <div className="divide-y divide-border">
        {q.data?.map((m) => (
          <div key={m.icao_hex} className="py-2 text-xs">
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={() => setIcao(icao === m.icao_hex ? null : m.icao_hex)}
                className="min-w-0 text-left"
              >
                <span className="font-bold neon-text-green">{m.registration || m.icao_hex}</span>
                {m.owner && <span className="text-muted-foreground ml-2 truncate">{m.owner}</span>}
                {m.county && <span className="text-muted-foreground ml-2">· {m.county}</span>}
              </button>
              <div className="flex items-center gap-3 shrink-0 tabular-nums">
                <span className="neon-text-orange">drift {m.drift_score == null ? "—" : Math.round(m.drift_score)}</span>
                <span className="text-muted-foreground">score {m.profile_score ?? "—"}</span>
              </div>
            </div>
            {m.top_dimensions.length > 0 && (
              <div className="text-muted-foreground mt-0.5">Driven by: {m.top_dimensions.join(", ")}</div>
            )}
            {icao === m.icao_hex && (
              <div className="mt-2">
                <BehaviorProfile icao={m.icao_hex} />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
