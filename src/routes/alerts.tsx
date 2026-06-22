import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Siren } from "lucide-react";
import { getRecentAlerts } from "@/lib/watchtower.functions";
import { z } from "zod";

const search = z.object({
  level: z.enum(["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"]).optional().default("ALL"),
});

export const Route = createFileRoute("/alerts")({
  head: () => ({ meta: [{ title: "Live Alerts // Watchtower" }] }),
  validateSearch: search,
  component: Alerts,
});

function Alerts() {
  const { level } = Route.useSearch();
  const nav = useNavigate({ from: "/alerts" });

  const q = useQuery({
    queryKey: ["alerts", level],
    queryFn: () =>
      getRecentAlerts({ data: { limit: 200, level: level === "ALL" ? undefined : level } }),
    refetchInterval: 30_000,
  });

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl neon-text-orange flex items-center gap-3">
            <Siren className="size-6" /> Live Alerts
          </h1>
          <p className="text-xs text-muted-foreground uppercase tracking-widest mt-1">
            AOI alerts feed · auto-refresh 30s · {q.data?.length ?? 0} shown
          </p>
        </div>
        <div className="flex gap-1">
          {(["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((lvl) => (
            <button
              key={lvl}
              onClick={() => nav({ search: { level: lvl } })}
              className={`px-3 py-1 text-[10px] uppercase tracking-widest rounded-sm border transition ${
                level === lvl
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:border-accent"
              }`}
            >
              {lvl}
            </button>
          ))}
        </div>
      </header>

      <div className="panel scanline overflow-hidden">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-widest text-muted-foreground bg-secondary/40">
            <tr>
              <th className="text-left py-2 px-3">Time</th>
              <th className="text-left py-2 px-3">Level</th>
              <th className="text-left py-2 px-3">ICAO</th>
              <th className="text-left py-2 px-3">Reg</th>
              <th className="text-right py-2 px-3">Alt (ft)</th>
              <th className="text-right py-2 px-3">Dist (mi)</th>
              <th className="text-left py-2 px-3">Reason</th>
              <th className="text-left py-2 px-3">Hash</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((a) => (
              <tr key={a.id} className="border-t border-border/40 hover:bg-secondary/30">
                <td className="py-2 px-3 tabular-nums text-muted-foreground whitespace-nowrap">
                  {new Date(a.captured_at).toLocaleString()}
                </td>
                <td className="py-2 px-3">
                  <span className={`px-1.5 py-0.5 text-[10px] uppercase rounded-sm border ${
                    a.alert_level === "CRITICAL"
                      ? "border-primary text-primary"
                      : "border-accent/40 text-accent"
                  }`}>{a.alert_level}</span>
                </td>
                <td className="py-2 px-3 font-mono neon-text-green">{a.icao_hex}</td>
                <td className="py-2 px-3">{a.registration || "—"}</td>
                <td className="py-2 px-3 text-right tabular-nums">{a.altitude_ft?.toLocaleString() ?? "—"}</td>
                <td className="py-2 px-3 text-right tabular-nums">{a.distance_mi ?? "—"}</td>
                <td className="py-2 px-3 text-muted-foreground max-w-[360px] truncate">{a.reason || "—"}</td>
                <td className="py-2 px-3 font-mono text-[10px] text-muted-foreground" title={a.sha256_hash || ""}>
                  {a.sha256_hash ? a.sha256_hash.slice(0, 10) + "…" : "—"}
                </td>
              </tr>
            ))}
            {q.isLoading && (
              <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {!q.isLoading && q.data?.length === 0 && (
              <tr><td colSpan={8} className="py-8 text-center text-muted-foreground uppercase tracking-widest">No alerts</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
