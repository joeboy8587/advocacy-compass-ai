import { useQuery } from "@tanstack/react-query";
import { Network, Loader2 } from "lucide-react";
import { getShellNetwork } from "@/lib/patterns.functions";

export function ShellNetworkPanel() {
  const q = useQuery({
    queryKey: ["shell-network"],
    queryFn: () => getShellNetwork(),
    refetchInterval: 600_000,
  });

  if (q.isLoading) {
    return (
      <div className="panel p-3 text-xs text-muted-foreground inline-flex items-center gap-2">
        <Loader2 className="size-3 animate-spin" /> Loading ownership network…
      </div>
    );
  }
  if (q.isError || !q.data) return null;
  const d = q.data;
  if (!d.companies.length && !d.alignment.length) return null;

  return (
    <section className="panel scanline p-4 space-y-4">
      <div>
        <div className="text-xs uppercase tracking-widest neon-text-green flex items-center gap-2">
          <Network className="size-4" /> Ownership / Shell Network
        </div>
        <p className="text-[11px] text-muted-foreground mt-1 max-w-3xl">
          {d.aircraft_count} aircraft tie back to {d.company_count} holding companies. Multiple tails under one shell,
          or one tail under several shells, is how ownership gets hard to trace.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {d.companies.map((c) => (
          <div key={c.company} className="border border-border rounded-sm p-3">
            <div className="text-xs neon-text-green">{c.company}</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5">
              {c.aircraft.length} aircraft
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {c.aircraft.map((a) => (
                <span
                  key={`${a.tail}-${a.edge}`}
                  className="text-[10px] font-mono px-2 py-0.5 border border-border rounded-sm text-muted-foreground"
                  title={a.edge}
                >
                  {a.tail}
                  {a.edge !== "owned by" ? ` · ${a.edge}` : ""}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {d.alignment.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
            Aircraft observed flying in alignment with monitored sheriff aircraft
          </div>
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="py-2 pr-3">Aircraft</th>
                  <th className="py-2 pr-3">Flying with</th>
                  <th className="py-2 pr-3 text-right">Times</th>
                  <th className="py-2 pr-3 text-right">Closest (km)</th>
                  <th className="py-2 pr-3">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {d.alignment.map((a, i) => (
                  <tr key={i} className="border-b border-border/40 hover:bg-secondary/40">
                    <td className="py-2 pr-3 font-mono neon-text-green">
                      {a.target_registration || a.target_icao || "—"}
                    </td>
                    <td className="py-2 pr-3">{a.kcso_registration || "—"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{a.events}</td>
                    <td className="py-2 pr-3 text-right tabular-nums neon-text-orange">{a.min_distance_km ?? "—"}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{a.last_seen?.slice(0, 10) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
