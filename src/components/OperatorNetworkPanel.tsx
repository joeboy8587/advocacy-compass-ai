import { useQuery } from "@tanstack/react-query";
import { Network, Loader2 } from "lucide-react";
import { getOperatorGnn } from "@/lib/profiler.functions";

function Bar({ label, value, hint }: { label: string; value: number | null; hint: string }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className="min-w-0 flex-1">
      <div className="flex justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono">{value == null ? "—" : `${pct}%`}</span>
      </div>
      <div className="h-1.5 bg-border/40 rounded-sm overflow-hidden mt-1">
        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[10px] text-muted-foreground mt-1">{hint}</div>
    </div>
  );
}

export function OperatorNetworkPanel({ search }: { search?: string }) {
  const q = useQuery({
    queryKey: ["operator-gnn", search || ""],
    queryFn: () => getOperatorGnn({ data: { operator: search || undefined } }),
  });

  return (
    <section className="panel p-5 space-y-3">
      <div className="text-xs uppercase tracking-widest neon-text-green flex items-center gap-2">
        <Network className="size-4" /> Operator Network Risk (ML)
      </div>
      <p className="text-xs text-muted-foreground max-w-3xl">
        Two plain measures from the network model: how much of an operator's flying looks like surveillance, and how
        tightly its aircraft coordinate with other operators' aircraft. Operators with no bar have not been scored yet.
      </p>

      {q.isLoading && (
        <div className="text-xs text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="size-3 animate-spin" /> Loading network scores…
        </div>
      )}
      {q.isError && <div className="text-xs text-destructive">{(q.error as Error)?.message}</div>}
      {q.data?.length === 0 && (
        <div className="text-xs text-muted-foreground italic">
          No network scores for this search yet.
        </div>
      )}

      <div className="space-y-3">
        {q.data?.map((o) => (
          <div key={o.operator_name} className="border border-border rounded-sm p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2 justify-between">
              <div className="text-sm neon-text-orange">{o.operator_name}</div>
              {o.community_label && (
                <span className="text-[10px] uppercase tracking-widest border border-accent/50 text-accent px-2 py-0.5">
                  {o.community_label}
                </span>
              )}
            </div>
            <div className="flex flex-col md:flex-row gap-4">
              <Bar label="Surveillance index" value={o.surveillance_index} hint="How much of its flying looks like watching the ground." />
              <Bar label="Coordination index" value={o.coordination_index} hint="How often it flies in step with other operators' aircraft." />
            </div>
            <div className="text-[10px] text-muted-foreground">
              {o.aircraft_count ? `${o.aircraft_count} aircraft in this operator's network` : "Aircraft count unknown"}
              {o.updated_at ? ` · scored ${new Date(o.updated_at).toLocaleDateString()}` : ""}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
