import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Radio, ShieldAlert, Plane } from "lucide-react";
import {
  getSpoofingFeed,
  getSpoofingBreakdown,
  getTopSpoofers,
} from "@/lib/watchtower.functions";

import { useState } from "react";

export const Route = createFileRoute("/spoofing")({
  head: () => ({
    meta: [
      { title: "Spoofing & Signal Anomalies // Watchtower" },
      { name: "description", content: "ML-detected ADS-B spoofing, masked altitude and impossible-physics signal anomalies." },
    ],
  }),
  component: SpoofingPage,
});

function SpoofingPage() {
  const [filter, setFilter] = useState<string>("");
  const breakdown = useQuery({
    queryKey: ["spoof-breakdown"],
    queryFn: () => getSpoofingBreakdown(),
    refetchInterval: 60_000,
  });
  const feed = useQuery({
    queryKey: ["spoof-feed", filter],
    queryFn: () => getSpoofingFeed({ data: { limit: 80, type: filter || undefined } }),
    refetchInterval: 30_000,
  });
  const top = useQuery({
    queryKey: ["top-spoofers"],
    queryFn: () => getTopSpoofers(),
    refetchInterval: 120_000,
  });

  const types = ["", "SPOOFING_SIGNAL", "MASKED_ALTITUDE", "IMPOSSIBLE_PHYSICS", "SURVEILLANCE_MASKING"];

  return (
    
      <div className="p-6 space-y-6">
        <header>
          <h1 className="text-2xl neon-text-orange flex items-center gap-2">
            <ShieldAlert className="size-6" /> Spoofing & Signal Anomalies
          </h1>
          <p className="text-xs text-muted-foreground uppercase tracking-widest mt-1">
            ml_anomaly_detections // 7d aggregate · 30s refresh
          </p>
        </header>

        {/* Breakdown */}
        <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {breakdown.data?.map((b) => (
            <button
              key={b.anomaly_type}
              onClick={() => setFilter(filter === b.anomaly_type ? "" : b.anomaly_type)}
              className={`panel p-3 text-left transition-all ${
                filter === b.anomaly_type ? "border-primary" : ""
              }`}
            >
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {b.anomaly_type.replace(/_/g, " ")}
              </div>
              <div className="text-2xl neon-text-orange tabular-nums mt-1">{b.n.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {b.aircraft} aircraft · avg score {b.avg_score}
              </div>
            </button>
          ))}
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Feed */}
          <section className="panel scanline lg:col-span-2 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs uppercase tracking-widest neon-text-orange flex items-center gap-2">
                <Radio className="size-4" /> Signal Anomaly Feed
                {filter && <span className="text-muted-foreground">// {filter}</span>}
              </div>
              <div className="flex gap-1">
                {types.map((t) => (
                  <button
                    key={t || "all"}
                    onClick={() => setFilter(t)}
                    className={`px-2 py-0.5 text-[10px] uppercase tracking-widest rounded-sm border ${
                      filter === t ? "border-accent text-accent" : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t ? t.split("_")[0] : "ALL"}
                  </button>
                ))}
              </div>
            </div>
            <div className="divide-y divide-border max-h-[640px] overflow-auto">
              {feed.isLoading && <div className="py-8 text-center text-xs text-muted-foreground">Loading…</div>}
              {feed.data?.map((e) => {
                const f = parseFeatures(e.features);
                return (
                  <div key={e.id} className="py-2 text-xs grid grid-cols-[120px_1fr_auto] gap-3 items-start">
                    <span className={`inline-block px-2 py-0.5 text-[10px] uppercase tracking-widest rounded-sm border ${
                      e.anomaly_type === "SPOOFING_SIGNAL" ? "text-primary border-primary"
                        : e.anomaly_type === "IMPOSSIBLE_PHYSICS" ? "text-primary border-primary/70"
                        : "text-accent border-accent/40"
                    }`}>
                      {e.anomaly_type.split("_")[0]}
                    </span>
                    <div className="min-w-0">
                      <div className="font-bold neon-text-green truncate">
                        {e.aircraft_registration || e.icao24 || "UNKNOWN"}
                        <span className="text-muted-foreground font-normal ml-2">
                          {e.county || "—"} · score {e.anomaly_score} · {e.confidence_level}
                        </span>
                      </div>
                      <div className="text-muted-foreground truncate">
                        {f?.reasoning || `${e.anomaly_type} detected`}
                      </div>
                    </div>
                    <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                      {timeAgo(e.detected_at)}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Top spoofers */}
          <section className="panel scanline p-4">
            <div className="text-xs uppercase tracking-widest neon-text-orange mb-3 flex items-center gap-2">
              <Plane className="size-4" /> Top Spoofers · 30d
            </div>
            <div className="space-y-2 max-h-[640px] overflow-auto">
              {top.data?.map((s) => (
                <div key={(s.icao24 || "") + s.aircraft_registration} className="border border-border/60 rounded-sm p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold neon-text-green">{s.aircraft_registration || "—"}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{s.icao24}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">{s.county || "—"}</div>
                  <div className="flex gap-3 mt-1 text-[10px] tabular-nums">
                    <span className="text-primary">SPOOF {s.spoof_events}</span>
                    <span className="text-accent">MASK {s.masked_events}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    
  );
}

function parseFeatures(s: string | null): { reasoning?: string } | null {
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
