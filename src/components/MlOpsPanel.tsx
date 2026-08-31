import { useQuery } from "@tanstack/react-query";
import { Cpu, Loader2, AlertTriangle } from "lucide-react";
import { getMlOpsHealth } from "@/lib/profiler.functions";

export function MlOpsPanel() {
  const q = useQuery({
    queryKey: ["mlops-health"],
    queryFn: () => getMlOpsHealth(),
    refetchInterval: 600_000,
  });

  if (q.isLoading) {
    return (
      <div className="panel p-3 text-xs text-muted-foreground inline-flex items-center gap-2">
        <Loader2 className="size-3 animate-spin" /> Checking model pipeline…
      </div>
    );
  }
  if (q.isError || !q.data) return null;
  const d = q.data;
  const m = d.latest_model;

  return (
    <section className="panel p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
      <div>
        <div className="text-xs uppercase tracking-widest neon-text-green flex items-center gap-2">
          <Cpu className="size-4" /> Model Card
        </div>
        {m ? (
          <p className="text-xs text-muted-foreground mt-2">
            <span className="neon-text-green">{m.model_name}</span> {m.model_version} · trained{" "}
            {d.model_age_hours == null ? "—" : d.model_age_hours < 48 ? `${d.model_age_hours}h ago` : `${Math.round(d.model_age_hours / 24)} days ago`} on{" "}
            {(m.training_samples ?? 0).toLocaleString()} flights, using {m.feature_count ?? "—"} behaviour measurements.
            It expects about {m.anomaly_rate == null ? "—" : `${Math.round(Number(m.anomaly_rate) * 100)}%`} of flights to look abnormal.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground mt-2">No trained model recorded.</p>
        )}
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Fingerprinting backlog</div>
        <div className={`text-xl tabular-nums mt-1 ${d.queue_stalled ? "text-destructive" : "neon-text-green"}`}>
          {d.pending.toLocaleString()}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          {d.pending === 0
            ? "Every aircraft in the queue has been fingerprinted."
            : d.queue_stalled
              ? "Aircraft waiting to be fingerprinted, and nothing has moved in over 48 hours — the embedding worker looks stopped."
              : "Aircraft waiting to be fingerprinted."}
        </p>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Recent training runs</div>
        <div className="mt-1 space-y-1">
          {d.models.slice(0, 4).map((r) => (
            <div key={r.trained_at} className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">{r.trained_at.slice(0, 10)}</span>
              <span className="tabular-nums">{(r.training_samples ?? 0).toLocaleString()} samples</span>
            </div>
          ))}
          {d.models.length === 0 && <div className="text-[11px] text-muted-foreground">No runs logged.</div>}
        </div>
        {d.queue_stalled && (
          <div className="text-[10px] uppercase tracking-widest text-destructive mt-2 flex items-center gap-1">
            <AlertTriangle className="size-3" /> queue stalled
          </div>
        )}
      </div>
    </section>
  );
}
