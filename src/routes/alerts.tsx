import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Siren, Download, Search, X } from "lucide-react";
import { getRecentAlerts, getAlertCounties } from "@/lib/watchtower.functions";
import { z } from "zod";
import { useMemo, useState, useEffect } from "react";

const search = z.object({
  level: z.enum(["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"]).optional().default("ALL"),
  county: z.string().optional().default("ALL"),
  q: z.string().optional().default(""),
});

export const Route = createFileRoute("/alerts")({
  head: () => ({ meta: [{ title: "Live Alerts // Watchtower" }] }),
  validateSearch: search,
  component: Alerts,
});

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function Alerts() {
  const { level, county, q: qParam } = Route.useSearch();
  const nav = useNavigate({ from: "/alerts" });
  const [tail, setTail] = useState(qParam);

  // keep input in sync if url changes externally
  useEffect(() => { setTail(qParam); }, [qParam]);

  const alerts = useQuery({
    queryKey: ["alerts", level, county, qParam],
    queryFn: () =>
      getRecentAlerts({
        data: {
          limit: 500,
          level: level === "ALL" ? undefined : level,
          county,
          search: qParam || undefined,
        },
      }),
    refetchInterval: 30_000,
  });

  const counties = useQuery({
    queryKey: ["alert-counties"],
    queryFn: () => getAlertCounties(),
    staleTime: 10 * 60_000,
  });

  const rows = alerts.data ?? [];

  const exportCsv = useMemo(
    () => () => {
      const header = [
        "captured_at", "alert_level", "icao_hex", "registration",
        "operator", "aircraft_model", "county",
        "altitude_ft", "distance_mi", "kcso", "military", "medical", "xp_services",
        "reason", "sha256_hash",
      ];
      const body = rows.map((a) => [
        a.captured_at, a.alert_level, a.icao_hex, a.registration,
        a.operator_name, a.aircraft_model, a.county,
        a.altitude_ft, a.distance_mi,
        a.kcso_flag, a.military_flag, a.medical_flag, a.xp_services_flag,
        a.reason, a.sha256_hash,
      ].map(csvEscape).join(","));
      const blob = new Blob([[header.join(","), ...body].join("\n")], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `watchtower-alerts-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [rows],
  );

  function submitTail(e: React.FormEvent) {
    e.preventDefault();
    nav({ search: (s) => ({ ...s, q: tail.trim() }) });
  }

  function clearTail() {
    setTail("");
    nav({ search: (s) => ({ ...s, q: "" }) });
  }

  return (
    <div className="p-6 space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl neon-text-orange flex items-center gap-3">
            <Siren className="size-6" /> Live Alerts
          </h1>
          <p className="text-xs text-muted-foreground uppercase tracking-widest mt-1">
            AOI alerts feed · auto-refresh 30s · {rows.length} shown
            {qParam && <> · tail:<span className="text-accent ml-1">{qParam}</span></>}
            {county !== "ALL" && <> · county:<span className="text-accent ml-1">{county}</span></>}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <form onSubmit={submitTail} className="flex items-center gap-1 border border-border rounded-sm bg-secondary/30 px-2">
            <Search className="size-3 text-muted-foreground" />
            <input
              value={tail}
              onChange={(e) => setTail(e.target.value)}
              placeholder="Tail / ICAO / operator…"
              className="bg-transparent text-xs px-1 py-1 w-52 outline-none placeholder:text-muted-foreground/60"
            />
            {tail && (
              <button type="button" onClick={clearTail} className="text-muted-foreground hover:text-foreground">
                <X className="size-3" />
              </button>
            )}
          </form>

          <select
            value={county}
            onChange={(e) => nav({ search: (s) => ({ ...s, county: e.target.value }) })}
            className="bg-secondary/30 border border-border rounded-sm text-xs px-2 py-1 uppercase tracking-widest"
          >
            <option value="ALL">All Counties</option>
            {counties.data?.map((c) => (
              <option key={c.county} value={c.county}>{c.county} ({c.count})</option>
            ))}
          </select>

          <div className="flex gap-1">
            {(["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((lvl) => (
              <button
                key={lvl}
                onClick={() => nav({ search: (s) => ({ ...s, level: lvl }) })}
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

          <button
            onClick={exportCsv}
            disabled={!rows.length}
            className="flex items-center gap-1 px-3 py-1 text-[10px] uppercase tracking-widest rounded-sm border border-accent/60 text-accent hover:bg-accent/10 disabled:opacity-40"
          >
            <Download className="size-3" /> CSV ({rows.length})
          </button>
        </div>
      </header>

      <div className="panel scanline overflow-x-auto">
        <table className="w-full text-xs min-w-[1100px]">
          <thead className="text-[10px] uppercase tracking-widest text-muted-foreground bg-secondary/40">
            <tr>
              <th className="text-left py-2 px-3">Time</th>
              <th className="text-left py-2 px-3">Level</th>
              <th className="text-left py-2 px-3">ICAO</th>
              <th className="text-left py-2 px-3">Tail</th>
              <th className="text-left py-2 px-3">Operator</th>
              <th className="text-left py-2 px-3">County</th>
              <th className="text-right py-2 px-3">Alt (ft)</th>
              <th className="text-right py-2 px-3">Dist (mi)</th>
              <th className="text-left py-2 px-3">Reason</th>
              <th className="text-left py-2 px-3">Hash</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
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
                <td className="py-2 px-3">
                  {a.registration ? (
                    <Link
                      to="/operators"
                      search={{ search: a.registration, flag: "ALL" } as never}
                      className="text-accent hover:underline font-mono"
                    >
                      {a.registration}
                    </Link>
                  ) : "—"}
                </td>
                <td className="py-2 px-3">
                  {a.operator_name ? (
                    <Link
                      to="/operators"
                      search={{ search: a.icao_hex ?? a.operator_name, flag: "ALL" } as never}
                      className="hover:text-accent"
                    >
                      <div className="truncate max-w-[220px]" title={a.operator_name}>
                        {a.operator_name}
                      </div>
                      <div className="flex gap-1 mt-0.5">
                        {a.kcso_flag && <span className="px-1 text-[9px] border border-primary/60 text-primary rounded-sm">KCSO</span>}
                        {a.military_flag && <span className="px-1 text-[9px] border border-accent/60 text-accent rounded-sm">MIL</span>}
                        {a.medical_flag && <span className="px-1 text-[9px] border border-border text-muted-foreground rounded-sm">MED</span>}
                        {a.xp_services_flag && <span className="px-1 text-[9px] border border-border text-muted-foreground rounded-sm">XP</span>}
                      </div>
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">{a.county ?? "—"}</td>
                <td className="py-2 px-3 text-right tabular-nums">{a.altitude_ft?.toLocaleString() ?? "—"}</td>
                <td className="py-2 px-3 text-right tabular-nums">{a.distance_mi ?? "—"}</td>
                <td className="py-2 px-3 text-muted-foreground max-w-[320px] truncate" title={a.reason ?? ""}>{a.reason || "—"}</td>
                <td className="py-2 px-3 font-mono text-[10px] text-muted-foreground" title={a.sha256_hash || ""}>
                  {a.sha256_hash ? a.sha256_hash.slice(0, 10) + "…" : "—"}
                </td>
              </tr>
            ))}
            {alerts.isLoading && (
              <tr><td colSpan={10} className="py-8 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {!alerts.isLoading && rows.length === 0 && (
              <tr><td colSpan={10} className="py-8 text-center text-muted-foreground uppercase tracking-widest">No alerts</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
