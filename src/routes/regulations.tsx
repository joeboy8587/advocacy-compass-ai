import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { BookOpen, Search } from "lucide-react";
import { getRegulations, getRegulationParts } from "@/lib/watchtower.functions";

export const Route = createFileRoute("/regulations")({
  head: () => ({ meta: [{ title: "FAA Regulations // Watchtower" }] }),
  component: RegulationsPage,
});

function RegulationsPage() {
  const [part, setPart] = useState<string>("");
  const [search, setSearch] = useState("");

  const parts = useQuery({
    queryKey: ["reg-parts"],
    queryFn: () => getRegulationParts(),
  });
  const regs = useQuery({
    queryKey: ["regs", part, search],
    queryFn: () => getRegulations({ data: { part: part || undefined, search: search || undefined } }),
  });

  return (
    <div className="p-6 space-y-4">
      <header>
        <h1 className="text-2xl neon-text-orange flex items-center gap-2">
          <BookOpen className="size-6" /> FAA Regulations Library
        </h1>
        <p className="text-xs text-muted-foreground uppercase tracking-widest mt-1">
          14 CFR · 1,152 sections searchable // for cross-reference in case briefs
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setPart("")}
          className={`px-3 py-1.5 text-[11px] uppercase tracking-widest border rounded-sm ${part === "" ? "bg-accent/20 border-accent text-accent" : "border-border text-muted-foreground hover:border-accent"}`}
        >
          All Parts
        </button>
        {parts.data?.slice(0, 20).map((p) => (
          <button
            key={p.part}
            onClick={() => setPart(p.part)}
            className={`px-3 py-1.5 text-[11px] uppercase tracking-widest border rounded-sm font-mono ${part === p.part ? "bg-accent/20 border-accent text-accent" : "border-border text-muted-foreground hover:border-accent"}`}
          >
            Part {p.part} <span className="ml-1 text-foreground">{p.count}</span>
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search section number, heading, or content (e.g. 91.119, minimum altitude)…"
          className="w-full bg-input/50 border border-border rounded-sm pl-10 pr-3 py-2 text-sm font-mono focus:border-accent outline-none"
        />
      </div>

      <section className="space-y-2">
        {regs.isLoading ? (
          <div className="text-xs text-muted-foreground">Loading regulations…</div>
        ) : !regs.data?.length ? (
          <div className="text-xs text-muted-foreground">No regulations match filters.</div>
        ) : (
          regs.data.map((r) => (
            <article key={r.id} className="panel p-4">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Title {r.title} · Part {r.part}
              </div>
              <h2 className="text-sm font-bold neon-text-orange mt-0.5 font-mono">
                {r.heading || `§ ${r.section}`}
              </h2>
              {r.content && (
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed whitespace-pre-wrap line-clamp-6">
                  {r.content}
                </p>
              )}
            </article>
          ))
        )}
      </section>
    </div>
  );
}
