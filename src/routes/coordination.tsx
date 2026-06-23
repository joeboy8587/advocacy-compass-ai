import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { GitBranch, Network, Brain, AlertTriangle } from "lucide-react";
import {
  getCoordinationLocks,
  getHandoffHypotheses,
  getRecentCoordinatedHypotheses,
  getIncursionFeed,
} from "@/lib/watchtower.functions";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/coordination")({
  head: () => ({
    meta: [
      { title: "Coordination & Handoffs // Watchtower" },
      { name: "description", content: "WTPR convergent locks, coordinated surveillance handoffs, and incursion events." },
    ],
  }),
  component: CoordinationPage,
});

function CoordinationPage() {
  const locks = useQuery({
    queryKey: ["coord-locks"],
    queryFn: () => getCoordinationLocks({ data: { limit: 80 } }),
    refetchInterval: 60_000,
  });
  const hyp = useQuery({
    queryKey: ["handoff-hypotheses"],
    queryFn: () => getHandoffHypotheses(),
    refetchInterval: 120_000,
  });
  const recent = useQuery({
    queryKey: ["coord-recent"],
    queryFn: () => getRecentCoordinatedHypotheses(),
    refetchInterval: 60_000,
  });
  const incursions = useQuery({
    queryKey: ["incursions"],
    queryFn: () => getIncursionFeed(),
    refetchInterval: 60_000,
  });

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <header>
          <h1 className="text-2xl neon-text-green flex items-center gap-2">
            <Network className="size-6" /> Coordination & Handoffs
          </h1>
          <p className="text-xs text-muted-foreground uppercase tracking-widest mt-1">
            wtpr_convergent_locks · mission_hypotheses · incursion_events
          </p>
        </header>

        {/* Hypothesis tile row */}
        <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {hyp.data?.map((h) => (
            <div key={h.hypothesis_type} className="panel p-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {h.hypothesis_type.replace(/_/g, " ")}
              </div>
              <div className="text-2xl neon-text-green tabular-nums mt-1">{h.n.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground mt-1">avg conf {h.avg_conf}</div>
            </div>
          ))}
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* WTPR convergent locks */}
          <section className="panel scanline p-4">
            <div className="text-xs uppercase tracking-widest neon-text-orange mb-3 flex items-center gap-2">
              <GitBranch className="size-4" /> WTPR Convergent Locks
              <span className="text-muted-foreground">// main ⇄ neighbor handoff pairs</span>
            </div>
            <div className="overflow-auto max-h-[560px]">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                    <th className="py-2 pr-3">Main WTPR</th>
                    <th className="py-2 pr-3">Neighbor</th>
                    <th className="py-2 pr-3 text-right">Corr</th>
                    <th className="py-2 pr-3 text-right">p-value</th>
                    <th className="py-2 pr-3">Confirmed</th>
                  </tr>
                </thead>
                <tbody>
                  {locks.data?.map((l) => (
                    <tr key={l.id} className="border-b border-border/40 hover:bg-secondary/40">
                      <td className="py-2 pr-3 font-mono text-[10px] neon-text-green truncate max-w-[200px]">{l.main_wtpr}</td>
                      <td className="py-2 pr-3 font-mono text-[10px] text-accent truncate max-w-[200px]">{l.nb_wtpr}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{Number(l.correlation_score).toFixed(2)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{Number(l.p_value).toExponential(1)}</td>
                      <td className="py-2 pr-3">
                        {l.machine_confirmed ? (
                          <span className="text-accent">✓ AUTO</span>
                        ) : (
                          <span className="text-muted-foreground">pending</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* High-confidence coordinated surveillance */}
          <section className="panel scanline p-4">
            <div className="text-xs uppercase tracking-widest neon-text-orange mb-3 flex items-center gap-2">
              <Brain className="size-4" /> High-Confidence Coordination Hypotheses
            </div>
            <div className="divide-y divide-border max-h-[560px] overflow-auto">
              {recent.data?.map((r) => {
                const parsed = parseChain(r.reasoning_chain);
                return (
                  <div key={r.id} className="py-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 text-[10px] uppercase tracking-widest rounded-sm border border-accent/60 text-accent">
                        {r.hypothesis_type.replace(/_/g, " ")}
                      </span>
                      <span className="text-[10px] tabular-nums neon-text-green">
                        {(Number(r.confidence_score) * 100).toFixed(0)}%
                      </span>
                    </div>
                    {parsed && (
                      <div className="mt-1 text-muted-foreground text-[11px] grid grid-cols-2 gap-x-3">
                        {parsed.county && <span>County: {parsed.county}</span>}
                        {parsed.zone && <span>Zone: {parsed.zone}</span>}
                        {parsed.alt_ft != null && <span>Alt: {parsed.alt_ft}ft</span>}
                        {parsed.speed_kts != null && <span>Speed: {parsed.speed_kts}kt</span>}
                      </div>
                    )}
                    <div className="text-[10px] text-muted-foreground mt-1">{timeAgo(r.updated_at)} ago · det {r.detection_id.slice(0, 8)}</div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Incursions */}
        <section className="panel scanline p-4">
          <div className="text-xs uppercase tracking-widest neon-text-orange mb-3 flex items-center gap-2">
            <AlertTriangle className="size-4" /> First-Time Low-Altitude Incursions
            <span className="text-muted-foreground">// historical floor breaks</span>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="py-2 pr-3">ICAO</th>
                  <th className="py-2 pr-3">Reg</th>
                  <th className="py-2 pr-3 text-right">Altitude</th>
                  <th className="py-2 pr-3 text-right">Prev Floor</th>
                  <th className="py-2 pr-3">Reasoning</th>
                  <th className="py-2 pr-3">When</th>
                </tr>
              </thead>
              <tbody>
                {incursions.data?.map((i) => (
                  <tr key={i.id} className="border-b border-border/40 hover:bg-secondary/40">
                    <td className="py-2 pr-3 font-mono neon-text-green">{i.icao_hex}</td>
                    <td className="py-2 pr-3">{i.registration}</td>
                    <td className="py-2 pr-3 text-right tabular-nums neon-text-orange">{i.altitude_ft}ft</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{i.prev_min_alt}ft</td>
                    <td className="py-2 pr-3 text-muted-foreground truncate max-w-[480px]">{i.reasoning}</td>
                    <td className="py-2 pr-3 text-[10px] text-muted-foreground">{timeAgo(i.event_timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function parseChain(s: string | null): { county?: string; zone?: string; alt_ft?: number; speed_kts?: number } | null {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function timeAgo(ts: string) {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
