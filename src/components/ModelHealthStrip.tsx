import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Brain, Loader2 } from "lucide-react";
import { getModelHealth } from "@/lib/profiler.functions";

export function ModelHealthStrip() {
  const q = useQuery({
    queryKey: ["model-health"],
    queryFn: () => getModelHealth(),
    refetchInterval: 300_000,
  });

  if (q.isLoading) {
    return (
      <div className="panel p-3 text-xs text-muted-foreground inline-flex items-center gap-2">
        <Loader2 className="size-3 animate-spin" /> Checking the behaviour model…
      </div>
    );
  }
  if (q.isError || !q.data) return null;
  const d = q.data;

  return (
    <section className={`panel p-4 flex flex-col md:flex-row md:items-center gap-3 justify-between ${d.stale ? "border-destructive/60" : ""}`}>
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-widest neon-text-green flex items-center gap-2">
          <Brain className="size-4" /> Behaviour Model
        </div>
        <p className={`text-sm mt-1 ${d.stale ? "text-destructive" : "text-muted-foreground"}`}>{d.status_label}</p>
      </div>
      <div className="flex gap-4 text-xs shrink-0">
        <Metric label="Aircraft profiled" value={d.aircraft_profiled.toLocaleString()} />
        <Metric label="Elevated (65+)" value={d.elevated_aircraft.toLocaleString()} tone="neon-text-orange" />
        <Metric label="Version" value={d.last_run?.model_version ?? "—"} />
        <Link
          to="/leads"
          className="self-center px-3 py-1.5 text-[10px] uppercase tracking-widest border border-accent text-accent rounded-sm"
        >
          Work leads
        </Link>
      </div>
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`font-mono text-sm ${tone ?? ""}`}>{value}</div>
    </div>
  );
}
