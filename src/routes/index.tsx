import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useSuspenseQuery, queryOptions, useQuery } from "@tanstack/react-query";

function ClientClock() {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const tick = () => setNow(new Date().toUTCString());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <div suppressHydrationWarning>{now || "\u00a0"}</div>;
}
import { Activity, AlertTriangle, FolderOpen, Plane, Radar, Siren, TrendingDown, Users } from "lucide-react";
import {
  getKpis,
  getRecentAlerts,
  getHourlyTimeline,
  getTopOffenders,
} from "@/lib/watchtower.functions";
import { Stat, fmt } from "@/components/cmd/Stat";
import { Link } from "@tanstack/react-router";

const kpisOpts = queryOptions({
  queryKey: ["kpis"],
  queryFn: () => getKpis(),
  refetchInterval: 30_000,
});

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Command Center // Watchtower" },
      { name: "description", content: "Live operations dashboard for the Watchtower advocacy command center." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(kpisOpts),
  component: Command,
  errorComponent: ({ error }) => (
    <div className="p-8 text-destructive">Failed to load: {error.message}</div>
  ),
});

function Command() {
  const { data: k } = useSuspenseQuery(kpisOpts);
  const alerts = useQuery({
    queryKey: ["recent-alerts", 15],
    queryFn: () => getRecentAlerts({ data: { limit: 15 } }),
    refetchInterval: 30_000,
  });
  const timeline = useQuery({
    queryKey: ["hourly-timeline"],
    queryFn: () => getHourlyTimeline(),
    refetchInterval: 60_000,
  });
  const offenders = useQuery({
    queryKey: ["top-offenders"],
    queryFn: () => getTopOffenders(),
    refetchInterval: 120_000,
  });

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl neon-text-green">Command Center</h1>
          <p className="text-xs text-muted-foreground uppercase tracking-widest mt-1">
            Last 24h surveillance window // auto-refresh 30s
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground uppercase tracking-widest">
          <ClientClock />
        </div>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Detections 24h" value={fmt(k.detections_24h)} icon={Radar} tone="green" />
        <Stat label="Unique Aircraft" value={fmt(k.unique_aircraft_24h)} icon={Plane} tone="cyan" />
        <Stat label="Anomalies" value={fmt(k.anomalies_24h)} icon={Activity} tone="orange" />
        <Stat
          label="Critical Alerts"
          value={fmt(k.critical_alerts_24h)}
          icon={Siren}
          tone="orange"
          hint="aoi_alerts // CRITICAL"
        />
        <Stat label="91.227 Violators" value={fmt(k.low_alt_violators_24h)} icon={TrendingDown} tone="magenta" hint="Low-altitude flagged" />
        <Stat label="Convergences" value={fmt(k.convergences_24h)} icon={Users} tone="green" />
        <Stat label="Sentinel Violations" value={fmt(k.violations_24h)} icon={AlertTriangle} tone="orange" />
        <Stat label="Active Cases" value={fmt(k.active_cases)} icon={FolderOpen} tone="green" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Live Alerts Feed */}
        <section className="panel scanline lg:col-span-2 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs uppercase tracking-widest neon-text-orange flex items-center gap-2">
              <Siren className="size-4" /> Live Alert Feed
            </div>
            <Link to="/alerts" className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-accent">
              View all →
            </Link>
          </div>
          <div className="divide-y divide-border max-h-[420px] overflow-auto">
            {alerts.isLoading && <Skel />}
            {alerts.data?.length === 0 && <Empty msg="No alerts in window." />}
            {alerts.data?.map((a) => (
              <div key={a.id} className="grid grid-cols-[80px_1fr_auto] gap-3 py-2 text-xs items-center">
                <span className={`px-2 py-0.5 text-[10px] uppercase tracking-widest rounded-sm border ${
                  a.alert_level === "CRITICAL"
                    ? "text-primary border-primary pulse-glow"
                    : "text-accent border-accent/40"
                }`}>
                  {a.alert_level}
                </span>
                <div className="min-w-0">
                  <div className="font-bold neon-text-green truncate">
                    {a.registration || a.icao_hex || "UNKNOWN"}
                    {a.altitude_ft != null && (
                      <span className="text-muted-foreground font-normal ml-2">
                        @ {a.altitude_ft.toLocaleString()}ft
                      </span>
                    )}
                  </div>
                  <div className="text-muted-foreground truncate">{a.reason || "—"}</div>
                </div>
                <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                  {timeAgo(a.captured_at)}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* 24h Timeline */}
        <section className="panel scanline p-4">
          <div className="text-xs uppercase tracking-widest neon-text-green mb-3 flex items-center gap-2">
            <Activity className="size-4" /> 24h Activity
          </div>
          {timeline.isLoading ? <Skel /> : <Sparkline data={timeline.data ?? []} />}
        </section>
      </div>

      {/* Repeat offenders */}
      <section className="panel scanline p-4">
        <div className="text-xs uppercase tracking-widest neon-text-orange mb-3 flex items-center gap-2">
          <Plane className="size-4" /> Top Repeat Low-Altitude Offenders · 7d
        </div>
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                <th className="py-2 pr-3">ICAO</th>
                <th className="py-2 pr-3">Registration</th>
                <th className="py-2 pr-3">Owner</th>
                <th className="py-2 pr-3 text-right">7d Detections</th>
                <th className="py-2 pr-3 text-right">Low-Alt Events</th>
                <th className="py-2 pr-3">Counties</th>
              </tr>
            </thead>
            <tbody>
              {offenders.isLoading && (
                <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {offenders.data?.map((o) => (
                <tr key={o.icao_hex} className="border-b border-border/40 hover:bg-secondary/40">
                  <td className="py-2 pr-3 font-mono neon-text-green">{o.icao_hex}</td>
                  <td className="py-2 pr-3">{o.registration || "—"}</td>
                  <td className="py-2 pr-3 text-muted-foreground truncate max-w-[260px]">{o.owner || "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{o.detections_7d}</td>
                  <td className="py-2 pr-3 text-right tabular-nums neon-text-orange">{o.low_alt_events}</td>
                  <td className="py-2 pr-3 text-muted-foreground truncate max-w-[260px]">{o.counties}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Sparkline({ data }: { data: { hour: string; detections: number; anomalies: number; alerts: number }[] }) {
  if (!data.length) return <Empty msg="No data" />;
  const max = Math.max(1, ...data.map((d) => d.detections));
  return (
    <div>
      <div className="flex items-end gap-1 h-32">
        {data.map((d, i) => {
          const h = Math.max(2, (d.detections / max) * 100);
          const hasAlert = d.alerts > 0;
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
              <div
                className={`w-full rounded-sm ${hasAlert ? "bg-primary" : "bg-accent/60"}`}
                style={{ height: `${h}%`, boxShadow: hasAlert ? "0 0 6px var(--neon-orange)" : undefined }}
              />
              <div className="absolute -top-7 left-1/2 -translate-x-1/2 hidden group-hover:block bg-card border border-border rounded px-2 py-1 text-[10px] whitespace-nowrap z-10">
                {d.detections} det · {d.anomalies} anom · {d.alerts} alert
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-2 tabular-nums">
        <span>-24h</span><span>-12h</span><span>now</span>
      </div>
    </div>
  );
}

function Skel() {
  return (
    <div className="space-y-2">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-8 bg-secondary/50 rounded-sm animate-pulse" />
      ))}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="py-8 text-center text-xs text-muted-foreground uppercase tracking-widest">{msg}</div>;
}

function timeAgo(ts: string) {
  const d = new Date(ts).getTime();
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
