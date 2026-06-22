import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, Search, Building2, MapPin } from "lucide-react";
import { getViolations, getViolationStats } from "@/lib/watchtower.functions";

export const Route = createFileRoute("/violations")({
  head: () => ({ meta: [{ title: "FAA Violations // Watchtower" }] }),
  component: ViolationsPage,
});

function ViolationsPage() {
  const [rule, setRule] = useState<string>("");
  const [search, setSearch] = useState("");

  const stats = useQuery({
    queryKey: ["violation-stats"],
    queryFn: () => getViolationStats(),
    refetchInterval: 60_000,
  });
  const list = useQuery({
    queryKey: ["violations", rule, search],
    queryFn: () => getViolations({ data: { rule: rule || undefined, search: search || undefined, limit: 300 } }),
    refetchInterval: 30_000,
  });

  return (
    <div className="p-6 space-y-4">
      <header>
        <h1 className="text-2xl neon-text-orange flex items-center gap-2">
          <AlertTriangle className="size-6" /> FAA Violations
        </h1>
        <p className="text-xs text-muted-foreground uppercase tracking-widest mt-1">
          Classified violations with operator + registry lookup // {list.data?.length ?? 0} shown
        </p>
      </header>

      {/* Rule breakdown */}
      <section className="panel p-4">
        <div className="text-xs uppercase tracking-widest neon-text-green mb-3">Violation Index by Rule</div>
        {stats.isLoading ? (
          <div className="text-xs text-muted-foreground">Loading rule stats…</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setRule("")}
              className={`px-3 py-1.5 text-[11px] uppercase tracking-widest border rounded-sm ${rule === "" ? "bg-accent/20 border-accent text-accent" : "border-border text-muted-foreground hover:border-accent"}`}
            >
              All
            </button>
            {stats.data?.map((s) => (
              <button
                key={s.rule_violated}
                onClick={() => setRule(s.rule_violated)}
                className={`px-3 py-1.5 text-[11px] uppercase tracking-widest border rounded-sm font-mono ${rule === s.rule_violated ? "bg-accent/20 border-accent text-accent" : "border-border text-muted-foreground hover:border-accent"}`}
              >
                {s.rule_violated} <span className="ml-1 text-foreground">{s.count}</span>
                <span className="ml-1 opacity-60">· {s.unique_aircraft} ac</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by operator name, registration, or ICAO hex…"
          className="w-full bg-input/50 border border-border rounded-sm pl-10 pr-3 py-2 text-sm font-mono focus:border-accent outline-none"
        />
      </div>

      {/* Table */}
      <section className="panel">
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-xs font-mono">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border sticky top-0 bg-card">
              <tr>
                <th className="text-left p-2">When</th>
                <th className="text-left p-2">Rule</th>
                <th className="text-left p-2">Reg / ICAO</th>
                <th className="text-right p-2">Alt</th>
                <th className="text-left p-2">Aircraft</th>
                <th className="text-left p-2">Operator</th>
                <th className="text-left p-2">Location</th>
              </tr>
            </thead>
            <tbody>
              {list.isLoading ? (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Loading violations…</td></tr>
              ) : !list.data?.length ? (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No violations match filters.</td></tr>
              ) : list.data.map((v) => (
                <tr key={v.detection_id} className="border-b border-border/30 hover:bg-sidebar-accent/30">
                  <td className="p-2 whitespace-nowrap">{new Date(v.captured_at).toLocaleString()}</td>
                  <td className="p-2"><span className="text-destructive">{v.rule_violated}</span></td>
                  <td className="p-2">
                    <div className="neon-text-orange">{v.registration ?? "—"}</div>
                    <div className="text-[10px] text-muted-foreground">{v.icao_hex}</div>
                  </td>
                  <td className="p-2 text-right">{v.altitude_ft ?? "—"}</td>
                  <td className="p-2">
                    <div>{v.aircraft_mfr ?? "—"}</div>
                    <div className="text-[10px] text-muted-foreground">{v.aircraft_model ?? ""}</div>
                  </td>
                  <td className="p-2">
                    <div className="flex items-center gap-1"><Building2 className="size-3 text-muted-foreground" />{v.owner_name ?? "—"}</div>
                    <div className="text-[10px] text-muted-foreground">{v.type_registrant ?? ""}</div>
                  </td>
                  <td className="p-2">
                    <div className="flex items-center gap-1"><MapPin className="size-3 text-muted-foreground" />{[v.owner_city, v.owner_state].filter(Boolean).join(", ") || "—"}</div>
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
