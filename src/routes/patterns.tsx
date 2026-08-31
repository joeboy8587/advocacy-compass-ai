import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { GitBranch, Loader2 } from "lucide-react";
import { getPatternFamilies, getPatterns } from "@/lib/patterns.functions";
import { LoadErrorPanel } from "@/components/LoadErrorPanel";

export const Route = createFileRoute("/patterns")({
  head: () => ({
    meta: [
      { title: "Tactical Patterns // Watchtower" },
      { name: "description", content: "Handoffs, coordination and physics anomalies the pattern miner found on its own." },
      { property: "og:title", content: "Tactical Patterns // Watchtower" },
      { property: "og:description", content: "Autonomously discovered flight patterns across the Watchtower detection feed." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PatternsPage,
  errorComponent: ({ error, reset }) => (
    <LoadErrorPanel error={error} reset={reset} title="Pattern feed didn't load" />
  ),
});

function PatternsPage() {
  const [type, setType] = useState<string | null>(null);
  const [icao, setIcao] = useState("");
  const [search, setSearch] = useState("");

  const families = useQuery({
    queryKey: ["pattern-families"],
    queryFn: () => getPatternFamilies({ data: { days: 30 } }),
    refetchInterval: 300_000,
  });
  const rows = useQuery({
    queryKey: ["patterns", type, search],
    queryFn: () => getPatterns({ data: { type: type ?? undefined, icao: search || undefined, days: search ? 90 : 3, limit: 80 } }),
    refetchInterval: 300_000,
  });

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <header>
        <h1 className="text-2xl neon-text-green flex items-center gap-2">
          <GitBranch className="size-6" /> Tactical Patterns
        </h1>
        <p className="text-xs text-muted-foreground mt-1 max-w-3xl">
          These are patterns the system found by itself in the raw detections — most often a handoff, where one aircraft
          leaves an area and another arrives within a couple of minutes. Confidence is the model's own certainty.
        </p>
      </header>

      <section className="space-y-2">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Pattern families · last 30 days</div>
        {families.isLoading && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
        {families.isError && <div className="text-xs text-destructive">Family counts unavailable.</div>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {families.data?.map((f) => (
            <button
              key={f.pattern_type}
              onClick={() => setType(type === f.pattern_type ? null : f.pattern_type)}
              className={`panel p-3 text-left ${type === f.pattern_type ? "border-accent" : ""}`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs neon-text-green font-mono">{f.pattern_type}</span>
                <span className="text-xs tabular-nums neon-text-orange">{f.n.toLocaleString()}</span>
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">{f.label}</div>
              <div className={`text-[10px] uppercase tracking-widest mt-1 ${f.stale ? "text-destructive" : "text-accent"}`}>
                {f.freshness} · avg confidence {f.avg_confidence ?? "—"}
              </div>
            </button>
          ))}
        </div>
      </section>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(icao.trim());
        }}
        className="flex gap-2"
      >
        <input
          value={icao}
          onChange={(e) => setIcao(e.target.value)}
          placeholder="Filter by ICAO hex (e.g. add08e)"
          className="bg-input border border-border rounded-sm px-3 py-2 text-xs flex-1 max-w-xs"
        />
        <button className="px-3 py-2 text-[10px] uppercase tracking-widest border border-accent text-accent rounded-sm">
          Search
        </button>
        {(search || type) && (
          <button
            type="button"
            onClick={() => { setSearch(""); setIcao(""); setType(null); }}
            className="px-3 py-2 text-[10px] uppercase tracking-widest border border-border text-muted-foreground rounded-sm"
          >
            Clear
          </button>
        )}
      </form>

      <section className="panel p-4">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
          {type ? `${type} · ` : ""}{search ? "last 90 days for this aircraft" : "last 72 hours"}
        </div>
        {rows.isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        {rows.isError && <div className="text-xs text-destructive">Patterns unavailable.</div>}
        {rows.data?.length === 0 && (
          <div className="py-8 text-center text-xs text-muted-foreground uppercase tracking-widest">
            No patterns in this window.
          </div>
        )}
        <div className="divide-y divide-border">
          {rows.data?.map((p) => (
            <div key={p.id} className="py-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono neon-text-green">{p.pattern_type}</span>
                <span className="tabular-nums text-muted-foreground">
                  confidence {p.confidence == null ? "—" : Math.round(p.confidence * 100)}% · {p.evidence_count ?? 0} evidence ·{" "}
                  {new Date(p.discovered_at).toISOString().replace("T", " ").slice(0, 16)}Z
                </span>
              </div>
              <p className="text-muted-foreground mt-1">{p.pattern_description || "—"}</p>
              {p.aircraft?.length ? (
                <div className="flex flex-wrap gap-1 mt-1">
                  {p.aircraft.slice(0, 8).map((a) => (
                    <button
                      key={a}
                      onClick={() => { setIcao(a); setSearch(a); }}
                      className="font-mono text-[10px] px-2 py-0.5 border border-border rounded-sm hover:border-accent hover:text-accent"
                    >
                      {a}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
