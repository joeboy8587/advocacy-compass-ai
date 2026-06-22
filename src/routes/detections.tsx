import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import { getRecentDetections } from "@/lib/watchtower.functions";
import { z } from "zod";

const search = z.object({
  lowAlt: z.boolean().optional().default(false),
});

export const Route = createFileRoute("/detections")({
  head: () => ({ meta: [{ title: "Detections // Watchtower" }] }),
  validateSearch: search,
  component: Detections,
});

function Detections() {
  const { lowAlt } = Route.useSearch();
  const nav = useNavigate({ from: "/detections" });
  const q = useQuery({
    queryKey: ["detections", lowAlt],
    queryFn: () => getRecentDetections({ data: { limit: 250, lowAltOnly: lowAlt } }),
    refetchInterval: 30_000,
  });

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl neon-text-green flex items-center gap-3">
            <Radio className="size-6" /> ADS-B Detections
          </h1>
          <p className="text-xs text-muted-foreground uppercase tracking-widest mt-1">
            Latest {q.data?.length ?? 0} · auto-refresh 30s
          </p>
        </div>
        <button
          onClick={() => nav({ search: { lowAlt: !lowAlt } })}
          className={`px-3 py-1 text-[10px] uppercase tracking-widest rounded-sm border ${
            lowAlt ? "bg-primary text-primary-foreground border-primary" : "border-border"
          }`}
        >
          91.227 Violators only
        </button>
      </header>

      <div className="panel scanline overflow-hidden">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-widest text-muted-foreground bg-secondary/40">
            <tr>
              <th className="text-left py-2 px-3">Time</th>
              <th className="text-left py-2 px-3">ICAO</th>
              <th className="text-left py-2 px-3">Reg</th>
              <th className="text-left py-2 px-3">Callsign</th>
              <th className="text-right py-2 px-3">Alt (ft)</th>
              <th className="text-right py-2 px-3">Speed</th>
              <th className="text-left py-2 px-3">County</th>
              <th className="text-left py-2 px-3">Zone</th>
              <th className="text-left py-2 px-3">Flags</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((d) => (
              <tr key={d.id} className="border-t border-border/40 hover:bg-secondary/30">
                <td className="py-2 px-3 tabular-nums text-muted-foreground whitespace-nowrap">
                  {new Date(d.captured_at).toLocaleTimeString()}
                </td>
                <td className="py-2 px-3 font-mono neon-text-green">{d.icao_hex}</td>
                <td className="py-2 px-3">{d.registration || "—"}</td>
                <td className="py-2 px-3 text-muted-foreground">{d.callsign || "—"}</td>
                <td className="py-2 px-3 text-right tabular-nums">{d.altitude_ft?.toLocaleString() ?? "—"}</td>
                <td className="py-2 px-3 text-right tabular-nums">{d.speed_kts ?? "—"}</td>
                <td className="py-2 px-3">{d.county || "—"}</td>
                <td className="py-2 px-3">{d.zone || "—"}</td>
                <td className="py-2 px-3 space-x-1">
                  {d.is_91_227_violator && <Tag tone="orange">91.227</Tag>}
                  {d.is_military && <Tag tone="cyan">MIL</Tag>}
                  {d.emergency && d.emergency !== "none" && <Tag tone="orange">{d.emergency}</Tag>}
                </td>
              </tr>
            ))}
            {q.isLoading && <tr><td colSpan={9} className="py-8 text-center text-muted-foreground">Loading…</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone: "orange" | "cyan" }) {
  const cls = tone === "orange" ? "border-primary text-primary" : "border-[color:var(--neon-cyan)] text-[color:var(--neon-cyan)]";
  return <span className={`px-1.5 py-0.5 text-[10px] uppercase rounded-sm border ${cls}`}>{children}</span>;
}
