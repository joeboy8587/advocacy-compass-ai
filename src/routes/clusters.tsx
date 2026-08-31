import { createFileRoute } from "@tanstack/react-router";
import { ExportBar } from "@/components/ExportBar";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Boxes, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { getBehaviorClusters, getClusterMembers } from "@/lib/profiler.functions";
import { BehaviorProfile } from "@/components/BehaviorProfile";
import { LoadErrorPanel } from "@/components/LoadErrorPanel";

export const Route = createFileRoute("/clusters")({
  head: () => ({
    meta: [
      { title: "Behaviour Clusters // Watchtower" },
      { name: "description", content: "Aircraft grouped by how they actually fly, translated into plain English." },
      { property: "og:title", content: "Behaviour Clusters // Watchtower" },
      { property: "og:description", content: "The Watchtower behaviour model groups every profiled aircraft by flight fingerprint." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ClustersPage,
  errorComponent: ({ error, reset }) => (
    <LoadErrorPanel error={error} reset={reset} title="Behaviour clusters didn't load" />
  ),
});

function ClustersPage() {
  const q = useQuery({
    queryKey: ["behavior-clusters"],
    queryFn: () => getBehaviorClusters(),
    refetchInterval: 300_000,
  });
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <header>
        <h1 className="text-2xl neon-text-green flex items-center gap-2">
          <Boxes className="size-6" /> Behaviour Clusters
        </h1>
        <p className="text-xs text-muted-foreground mt-1 max-w-3xl">
          The model puts every profiled aircraft into a group of airframes that fly the same way. A group is not an
          accusation — it is a starting point. Open a group to see who is in it and what makes it unusual.
        </p>
        <ExportBar rows={q.data?.clusters as unknown as Array<Record<string, unknown>>} fileName="behaviour-clusters" note="csv = rows shown · print = full page" />
      </header>

      {q.isLoading && (
        <div className="panel p-4 text-xs text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="size-3 animate-spin" /> Grouping the fleet…
        </div>
      )}
      {q.isError && <LoadErrorPanel error={q.error} reset={() => q.refetch()} title="Clusters unavailable" />}

      {q.data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Tile label="Grouped aircraft" value={q.data.grouped_aircraft.toLocaleString()} />
            <Tile label="Behaviour groups" value={q.data.clusters.length.toLocaleString()} />
            <Tile
              label="Not yet grouped"
              value={q.data.ungrouped_aircraft.toLocaleString()}
              hint="too little flying to fingerprint"
            />
          </div>

          <div className="space-y-2">
            {q.data.clusters.map((c) => {
              const isOpen = open === c.behavioral_cluster;
              return (
                <section key={c.behavioral_cluster} className="panel">
                  <button
                    onClick={() => setOpen(isOpen ? null : c.behavioral_cluster)}
                    className="w-full text-left p-4 flex items-start gap-3"
                  >
                    {isOpen ? <ChevronDown className="size-4 mt-0.5 text-accent" /> : <ChevronRight className="size-4 mt-0.5 text-accent" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-sm neon-text-green">{c.headline}</span>
                        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                          {c.aircraft.toLocaleString()} aircraft
                        </span>
                        <span className="text-[10px] uppercase tracking-widest neon-text-orange">
                          avg score {c.avg_score ?? "—"}
                        </span>
                        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                          avg drift {c.avg_drift ?? "—"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{c.meaning}</p>
                    </div>
                  </button>
                  {isOpen && <ClusterMembers cluster={c.behavioral_cluster} />}
                </section>
              );
            })}
          </div>

          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {q.data.ungrouped_aircraft.toLocaleString()} aircraft sit outside every group — usually because they were
            seen too briefly to fingerprint. They are excluded from the averages above.
          </p>
        </>
      )}
    </div>
  );
}

function ClusterMembers({ cluster }: { cluster: number }) {
  const q = useQuery({
    queryKey: ["cluster-members", cluster],
    queryFn: () => getClusterMembers({ data: { cluster, limit: 40 } }),
  });
  const [icao, setIcao] = useState<string | null>(null);

  if (q.isLoading) {
    return (
      <div className="px-4 pb-4 text-xs text-muted-foreground inline-flex items-center gap-2">
        <Loader2 className="size-3 animate-spin" /> Loading members…
      </div>
    );
  }
  if (q.isError) return <div className="px-4 pb-4 text-xs text-destructive">Members unavailable.</div>;

  return (
    <div className="px-4 pb-4 space-y-3">
      <div className="overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
              <th className="py-2 pr-3">ICAO</th>
              <th className="py-2 pr-3">Tail</th>
              <th className="py-2 pr-3">Owner</th>
              <th className="py-2 pr-3">County</th>
              <th className="py-2 pr-3 text-right">Score</th>
              <th className="py-2 pr-3 text-right">Drift</th>
              <th className="py-2 pr-3">What stands out</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {q.data?.map((m) => (
              <tr key={m.icao_hex} className="border-b border-border/40 hover:bg-secondary/40">
                <td className="py-2 pr-3 font-mono neon-text-green">{m.icao_hex}</td>
                <td className="py-2 pr-3">{m.registration || "—"}</td>
                <td className="py-2 pr-3 text-muted-foreground truncate max-w-[220px]">{m.owner || "—"}</td>
                <td className="py-2 pr-3 text-muted-foreground">{m.county || "—"}</td>
                <td className="py-2 pr-3 text-right tabular-nums neon-text-orange">{m.profile_score ?? "—"}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{m.drift_score == null ? "—" : Math.round(m.drift_score)}</td>
                <td className="py-2 pr-3 text-muted-foreground truncate max-w-[220px]">
                  {m.top_dimensions.join(", ") || "—"}
                </td>
                <td className="py-2 text-right">
                  <button
                    onClick={() => setIcao(icao === m.icao_hex ? null : m.icao_hex)}
                    className="px-2 py-1 text-[10px] uppercase tracking-widest border border-accent text-accent rounded-sm"
                  >
                    {icao === m.icao_hex ? "Hide" : "Profile"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {icao && <BehaviorProfile icao={icao} />}
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="panel p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-xl neon-text-green tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}
