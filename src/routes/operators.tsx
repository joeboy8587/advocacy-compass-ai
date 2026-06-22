import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Users, Search, Shield, Heart, Plane, Briefcase } from "lucide-react";
import { getOperators, lookupRegistry } from "@/lib/watchtower.functions";

export const Route = createFileRoute("/operators")({
  head: () => ({ meta: [{ title: "Operators // Watchtower" }] }),
  component: OperatorsPage,
});

const FLAGS = ["ALL", "KCSO", "MIL", "MED", "XP"] as const;

function OperatorsPage() {
  const [flag, setFlag] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [regSearch, setRegSearch] = useState("");

  const ops = useQuery({
    queryKey: ["operators", flag, search],
    queryFn: () => getOperators({ data: { flag, search: search || undefined, limit: 200 } }),
    refetchInterval: 60_000,
  });

  const reg = useQuery({
    queryKey: ["registry", regSearch],
    queryFn: () => lookupRegistry({ data: { q: regSearch } }),
    enabled: regSearch.length >= 2,
  });

  return (
    <div className="p-6 space-y-4">
      <header>
        <h1 className="text-2xl neon-text-orange flex items-center gap-2">
          <Users className="size-6" /> Operators &amp; FAA Registry
        </h1>
        <p className="text-xs text-muted-foreground uppercase tracking-widest mt-1">
          17,712 canonical operator profiles · cross-referenced to FAA N-number registry
        </p>
      </header>

      {/* FAA Registry Lookup */}
      <section className="panel p-4">
        <div className="text-xs uppercase tracking-widest neon-text-green mb-3">FAA N-Number Registry Lookup</div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            value={regSearch}
            onChange={(e) => setRegSearch(e.target.value)}
            placeholder="N-number, owner name, or mode-S hex…"
            className="w-full bg-input/50 border border-border rounded-sm pl-10 pr-3 py-2 text-sm font-mono focus:border-accent outline-none"
          />
        </div>
        {regSearch.length >= 2 && (
          <div className="mt-3 overflow-auto max-h-72">
            {reg.isLoading ? (
              <div className="text-xs text-muted-foreground p-2">Searching FAA registry…</div>
            ) : !reg.data?.length ? (
              <div className="text-xs text-muted-foreground p-2">No matches in FAA registry.</div>
            ) : (
              <table className="w-full text-xs font-mono">
                <thead className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left p-1.5">N-Number</th>
                    <th className="text-left p-1.5">Mode-S</th>
                    <th className="text-left p-1.5">Owner</th>
                    <th className="text-left p-1.5">City/State</th>
                    <th className="text-left p-1.5">Aircraft</th>
                    <th className="text-left p-1.5">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {reg.data.map((r) => (
                    <tr key={r.n_number} className="border-b border-border/30">
                      <td className="p-1.5 neon-text-orange">N{r.n_number}</td>
                      <td className="p-1.5">{r.mode_s_hex ?? "—"}</td>
                      <td className="p-1.5">{r.registrant_name ?? "—"}</td>
                      <td className="p-1.5">{[r.registrant_city, r.registrant_state].filter(Boolean).join(", ") || "—"}</td>
                      <td className="p-1.5">{[r.aircraft_manufacturer, r.aircraft_model].filter(Boolean).join(" ") || "—"}</td>
                      <td className="p-1.5 text-muted-foreground">{r.registrant_type ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>

      {/* Operator search + flags */}
      <div className="flex flex-wrap items-center gap-2">
        {FLAGS.map((f) => (
          <button
            key={f}
            onClick={() => setFlag(f)}
            className={`px-3 py-1.5 text-[11px] uppercase tracking-widest border rounded-sm ${flag === f ? "bg-accent/20 border-accent text-accent" : "border-border text-muted-foreground hover:border-accent"}`}
          >
            {f}
          </button>
        ))}
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter operators…"
            className="w-full bg-input/50 border border-border rounded-sm pl-10 pr-3 py-2 text-sm font-mono focus:border-accent outline-none"
          />
        </div>
      </div>

      <section className="panel">
        <div className="overflow-auto max-h-[60vh]">
          <table className="w-full text-xs font-mono">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border sticky top-0 bg-card">
              <tr>
                <th className="text-left p-2">ICAO / Reg</th>
                <th className="text-left p-2">Operator</th>
                <th className="text-left p-2">Aircraft</th>
                <th className="text-right p-2">Detections</th>
                <th className="text-right p-2">Violations</th>
                <th className="text-left p-2">Flags</th>
                <th className="text-left p-2">Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {ops.isLoading ? (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Loading operators…</td></tr>
              ) : !ops.data?.length ? (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No operators match filters.</td></tr>
              ) : ops.data.map((o) => (
                <tr key={o.icao_hex} className="border-b border-border/30 hover:bg-sidebar-accent/30">
                  <td className="p-2">
                    <div className="neon-text-orange">{o.registration ?? "—"}</div>
                    <div className="text-[10px] text-muted-foreground">{o.icao_hex}</div>
                  </td>
                  <td className="p-2">
                    <div>{o.operator_resolved ?? o.faa_registrant_name ?? "—"}</div>
                    {o.faa_registrant_name && o.operator_resolved && o.faa_registrant_name !== o.operator_resolved && (
                      <div className="text-[10px] text-muted-foreground">FAA: {o.faa_registrant_name}</div>
                    )}
                  </td>
                  <td className="p-2">{o.aircraft_model ?? "—"}</td>
                  <td className="p-2 text-right">{o.occurrences_total?.toLocaleString() ?? 0}</td>
                  <td className="p-2 text-right">
                    <span className={o.violation_count > 0 ? "text-destructive font-bold" : "text-muted-foreground"}>
                      {o.violation_count}
                    </span>
                  </td>
                  <td className="p-2">
                    <div className="flex gap-1">
                      {o.kcso_flag && <span title="KCSO" className="px-1 bg-accent/20 text-accent text-[9px] rounded">KCSO</span>}
                      {o.military_flag && <Shield className="size-3 text-destructive" />}
                      {o.medical_flag && <Heart className="size-3 text-accent" />}
                      {o.xp_services_flag && <Briefcase className="size-3 text-primary" />}
                      {!o.kcso_flag && !o.military_flag && !o.medical_flag && !o.xp_services_flag && <Plane className="size-3 text-muted-foreground" />}
                    </div>
                  </td>
                  <td className="p-2 whitespace-nowrap text-muted-foreground">
                    {o.last_seen ? new Date(o.last_seen).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
